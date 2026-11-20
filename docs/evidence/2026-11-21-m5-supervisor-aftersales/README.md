# M5-1 总管售后与批量验收

- **日期**：2026-11-21
- **分支**：`feat/m5-1-supervisor-aftersales`
- **真实引擎**：本机 Claude Code（`claude-sdk`）；总管模型 deepseek-flash
- **workspace**：临时 `demo` 仓库（`git init`，无 `package.json`；路径不写入仓库）
- **证据截图**：`01-supervisor-after-sales.png`、`02-task-review.png`

## 售后链路

1. 对总管说“在 demo 仓库创建一个 hello.txt，内容写 hello，然后直接开工。”
   - 总管创建 Agent 节点与任务，状态 `queued`，真实 Claude 启动。
   - 第一次会话请求 `Write` 审批；人工允许后写入 `hello.txt`，任务进入 `review`。
   - workspace 没有 `package.json`/test，按 PR #26 的规则跳过自动 verify，进入人工验收。
   - 人工点“通过”，任务 `done`。
2. 对总管说“上次那个 demo 仓库的 hello.txt 任务还有个问题，请跟进：把内容改成 hello baton，然后开工。”
   - 总管先 `list_tasks` 找到任务，再 `reopen_task` 且 `start=true`；任务回到 `queued`。
   - 第二次会话（会话 2）读取 `hello.txt`，请求 `Edit` 审批；人工允许后改为 `hello baton`。
   - 任务再次进入 `review`；验收员给出初步 PASS，任务仍停在 `review`，等待人工终审。
3. `GET /api/tasks/:id` 显示该任务有 2 个 session、2 条 approval（Write/Edit 均已 `allow`）；截图只展示任务标题、状态、reopen_task 工具卡与验收摘要。

## 验收中发现并修复

- 真实链路暴露：总管回复“已重开任务《在 demo 仓库创建 hello.txt…》”时，claim 守卫把任务标题里的“创建”误判成“总管声称已建任务”，追加了错误的“我没有创建任务”提示。
- 修复：收窄 create claim 正则，只匹配“已建/已创建/任务已创建”等自身声明；新增单测 `does not treat a task title containing 创建 as a create claim`。修复提交 `a8f5846`。
- 修复后重跑售后链路，`reopen_task` 工具卡与回复不再出现误提示（见 `01-supervisor-after-sales.png`）。

## 自动化验证

- `pnpm verify`：typecheck、lint、format、boundaries、protocol、daemon 285 tests、build 全绿。
- `pnpm verify:full`：35 条 Playwright 全绿，包含新增的 `supervisor-aftersales.spec.ts`（批量 3 卡、retry、取消确认）。
- `pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿。

## 脱敏检查

- 截图只包含虚构 `demo` workspace、任务标题、状态与工具卡；不含用户名、主机名、本机绝对路径、token 或 transcript 正文。
- 证据目录不记录真实任务 ID 与真实 workspace 路径。
