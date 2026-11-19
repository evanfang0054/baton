# M2-2b 移动端响应式控制台验收

日期：2026-11-19
Spec：[M2-2b 移动端响应式控制台设计](../../specs/2026-11-19-m2-2b-mobile-console-design.md)
Contract：[M2-2b 移动端响应式控制台](../../contracts/M2-2b-mobile-console.contract.md)

## 环境

- daemon 与 web 使用临时 `$BATON_DATA_DIR`、`$BATON_WORKSPACES_ROOT`，不污染本机数据。
- 真实 Claude 使用 host-native 登录态，不记录账号与模型账号信息。
- 移动视口：390×844（ego-lite H5 视窗，CDP device metrics）。
- 平板视口：768×1024；桌面回归：1280×800。
- 示例工作区 `<workspace>` 内只有 `src/mobile.txt` 与 `.baton/{policy.json,verify.sh}`。

## 截图

| 文件 | 来源 | 说明 |
|---|---|---|
| `01-mobile-board.png` | Playwright 固定 fixture | 移动看板：待审批/待回复/待验收/需关注分组、批量开工入口、顶部自动化状态、底部导航 |
| `02-create-task.png` | Playwright 固定 fixture | 移动建任务：Agent/上下文选择、任务引擎 `claude-sdk`、创建与创建并开工 |
| `03-approval.png` | Playwright 固定 fixture | 审批卡：Edit `src/mobile.txt`；真实审批 transcript 含本机绝对路径，故用相对路径 fixture 代替 |
| `04-done.png` | ego-lite 实机 | 真实 Claude 任务完成；已裁掉含绝对路径的 transcript |
| `05-more-menu.png` | Playwright 固定 fixture | 更多菜单：建任务、节点列表、自动化设置、创建/撤销信任、暂停自动化 |
| `06-tablet.png` | Playwright 固定 fixture | 768 平板：保留画布与右栏，看板默认收起，顶栏两行不挤压 |

截图均不含 token、用户名、邮箱、主机名或本机绝对路径。

## 真实 Claude 闭环

### 成功路径

1. 手机创建并信任工作区 `<workspace>`（项目 hooks 保持关闭）。
2. 手机创建 Agent 节点（引擎 `claude-sdk`）与文本上下文节点。
3. 手机新建任务「移动端真实 Claude 任务」，选择 Agent 与上下文，创建后开工。
4. 真实 Claude 触发 `Write` 审批，在手机上允许。
5. policy verify 通过，退出码 `0`；手机验收「通过」，任务进入 `done`。
6. 任务详情、会话、verify 结果均在移动端可见，无桌面浏览器参与。

### 打回路径

1. 手机新建任务「移动端打回演示」，prompt 要求把 `src/mobile.txt` 改成 `MOBILE-FAIL`。
2. 真实 Claude 触发 `Edit` 审批，在手机上允许。
3. policy verify（`grep -q MOBILE-DONE src/mobile.txt`）失败，退出码 `1`，任务进入 `review`。
4. 手机点「打回」，填写反馈并确认；任务先回到 `queued`，随后被调度器立即拾起为 `running`（见下文偏差）。
5. 第二会话再次触发 `Bash` 审批；为清理环境，通过 `task.cancel` 命令取消任务。

### 审批拒绝样本

另有一次临时任务在手机上对 `Edit` 审批点「拒绝」并取消任务，确认拒绝路径可用；该次未保留截图。

## 自动化验证

| 项目 | 结果 |
|---|---|
| web 单测 | 174 passed（45 files） |
| Playwright | 25 passed（桌面 + 平板 + 移动壳/任务/控制面/多视口矩阵） |
| `pnpm verify` | exit 0（typecheck、lint、format、boundaries、protocol、test、build） |
| `pnpm pack:check` | ok |
| `pnpm check:secrets` | no leaks（188 commits） |
| 视口矩阵 | 360 / 390 / 768 / 1280 全绿，无横向溢出 |
| 桌面/平板回归 | 三栏壳、画布、右栏、看板收起均通过 |

本地跑全量 e2e 时 5173 被无关进程占用，使用临时 Playwright 配置在 5199 跑完 25 条；仓库内 `playwright.config.ts` 未改动，CI 仍使用 5173。

## 性能

- web JS：`dist/assets/index-*.js` 978.64 kB，Vite gzip 300.80 kB。
- 按计划命令对全部 JS 做 gzip：297,218 bytes。
- CSS：496.91 kB，gzip 47.76 kB。
- 未超过 400 KB gzip 触发线；暂不引入 `React.lazy` 拆分画布，作为后续优化项。

## 残留风险与偏差

- 真实审批样本数量有限：覆盖 `Write`、`Edit`、`Bash`，拒绝审批只走过一次且未留截图。
- `review` 打回后当前 core 直接 `queued` 并立即入队，实际会被调度器马上拉起为 `running`；与计划文字中的「回到 todo/queued」不完全一致。是否需要「打回后等待人工再开工」需在后续 spec/ADR 中明确。
- 临时工作区不是 git 仓库，验收卡 `Git 文件` 统计为 0；这是环境限制，不是产品缺陷。
- 手机 token 与桌面权限相同；手机丢失时应轮换 `BATON_TOKEN` 并重启 daemon。cookie 为 HttpOnly，前端不写 localStorage。
- 移动端不提供画布、删除节点、连线与图片/group/review 节点编辑；这些仍只在桌面完成。
- 移动回复、验收、总管、汇报、信任目前以组件测试与既有桌面 e2e 为主，未逐一补移动 e2e；已列入后续补测。
- verify 输出未单独截图；证据保留完成态截图与退出码 0 的记录，避免 transcript 中的本机路径进入仓库。
