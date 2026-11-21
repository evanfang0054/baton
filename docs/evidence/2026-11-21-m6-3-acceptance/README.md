# M6-3 验收证据真实链路

- **日期**：2026-11-21
- **环境**：macOS，本地 `baton` daemon（`127.0.0.1:7317`），临时数据目录与临时工作区。
- **真实引擎**：本机 Claude Code 登录态（未设置 `ANTHROPIC_API_KEY`），`claude-sdk` 引擎；验收员同为真实 Claude。
- **说明**：临时目录、主机名、账号与 token 均未写入仓库；截图中的会话记录区域在取证前隐藏，避免带出绝对路径。

## 场景与结果

### 1. 真实任务生成验收清单

任务：在工作区根目录创建 `greeting.txt`（内容为 `hello baton`），并在 `README.md` 末尾追加一行；配置 verify 命令检查文件内容。

- worker 完成 → `review`；验收员真实运行并输出 `<acceptance_report>`。
- AC：3 条全部 `pass`；verdict `pass`；合同 `draft`，revision `1`，无截断。
- 成本：worker `$0.2886` / verifier `$0.1498`；任务预算 `$2.00`，已花 `$0.2886`。
- 报告 hash：`b55f0865a43cda88452322acba033741b4f071026486b2ca486fb91111e12ba0`。
- 截图：`01-review-card.png`（画布 review 卡 AC 3/3、成本、查看证据）、`02-ac-editor.png`（报告 + AC 编辑器）。

### 2. 人工改 AC + override 通过

- 在 AC 编辑器把第 3 条从 `pass` 改为 `fail` 并保存；画布 review 卡立即变为 `AC 2/3`，显示未过项。
- 点击通过，出现二次确认「仍有验收项未通过，仍要通过吗？」与理由输入框。
- 填写理由并确认后任务 `done`；审计写入 `review.decide`，含合同 id/version/revision、报告 hash、counts、verdict 与 `overrideReason`。
- 审计中的报告 hash：`92d4f6e8bb522920630bd95431b7cfb79dc7c40c6b9584c7ec555e4cd1ac410d`。
- 截图：`03-ac-override.png`（二次确认与理由输入）。

### 3. 低预算硬停 + 提额新 run

任务：创建 `budget2.txt`；任务预算 `$0.05`。

- 首轮在预算上限处停止：`waiting_input(budget)`，`attention=needs_approval`，UI 显示预算卡。
- 通过 UI 提额到 `$1.00`：审计 `task.budget.raise`（旧 `0.05` → 新 `1`，spent `0`）与 `task.budget.resume`；任务开新一轮 session（未使用 SDK session resume）。
- 新 run 完成 → `review`；验收员生成 AC 3/3 `pass`。
- 累计成本：worker `$0.3787`、verifier `$0.1571`；预算 `$1.00`；报告 hash `66bcc50108544512126176c57053d868f96e5f497b7bd3224ad0e1b62e6335cc`。
- 截图：`04-budget-card.png`（预算卡）、`05-budget-resumed.png`（提额后 review 卡 `$0.38/$1.00`、AC 3/3）。

## 真实链路暴露并已修复的问题

1. **人工任务不派验收员**：原实现只在 `supervisor-chat` 来源的任务进入 review 时派验收员，人工任务永远没有 AC。已改为所有任务进入 review 都派验收员；没有总管会话的任务只写审计与验收结果，不推站内消息。
2. **验收员只读请求仍需人工批准**：人工任务的验收员没有 workspace 委派授权，`git status/diff` 会停在审批。已改为验收员的只读工具/安全只读命令自动放行；策略 deny 与工作区逃逸检查仍然优先。
3. **保存 AC 后 review 卡不刷新**：`onDone` 没有失效 acceptance 查询，导致保存失败项后 review 卡仍显示旧的 `3/3`，直接通过才被 daemon 拒绝。已补 acceptance 查询失效，并加回归测试。
4. **任务详情缺 acceptance/budget 紧凑字段**：预算任务未进入 review 时 `acceptance=null`，预算卡拿不到预算摘要。已给 `TaskDetailResponse` 增加 `acceptance` 与 `budget`，详情页优先使用详情预算。
5. **重启把预算停止降级成 stalled**：boot reconcile 会把所有 `waiting_input` 改成 `stalled`，预算任务重启后丢失提额入口。已保留 `waiting_input(budget)`，并加回归测试。

## 已知限制

- 总管真实问答未运行：临时环境未配置 `supervisor.json`，总管模型不可用；总管字段与“不声称已通过”由 daemon 测试与 Playwright mock 覆盖。
- override 场景是人工把一条 AC 改为 `fail` 后演示的，不是验收员真实判负；验收员真实输出为 3/3 `pass`。
- 低预算首轮停止时 SDK 未上报成本，`spent` 为 `0`；提额后的 worker/verifier 成本正常上报。
- 截图为完整浏览器视口；会话记录（可能含绝对路径）在截图前隐藏，未做后期涂抹。

## 截图

- `01-review-card.png`：画布 review 卡 AC 3/3、成本、查看证据。
- `02-ac-editor.png`：验收报告 + 可编辑 AC 清单。
- `03-ac-override.png`：失败项通过二次确认与理由输入。
- `04-budget-card.png`：`waiting_input(budget)` 预算卡与提额入口。
- `05-budget-resumed.png`：提额新 run 后的 review 卡 `$0.38/$1.00`、AC 3/3。
