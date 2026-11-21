# M5-3 上下文交接验收

- **日期**：2026-11-21
- **分支**：`feat/m5-3-context-handoff`
- **提交**：`325c1ab`（core 摘要）、`c9217b9`（protocol）、`d587624`（core 策略）、`0dd714e`（daemon）、`95a276d`/`14c0c30`（web）、`7a7820a`（e2e）
- **状态**：自动验收 + 真实 Claude + ego-lite 证据完成

## 自动验证

- `pnpm verify:full`：protocol 119、core 143、adapters 27、web 204、daemon 294 tests；Playwright 38 条全绿。
- `pnpm pack:check`：ok。
- `apps/web/e2e/handoff.spec.ts`：
  - 任务详情点击「生成交接节点」→ WS `task.handoff` → 画布出现 `【交接】` 节点并刷新。
  - 重复交接 → 两个独立快照节点都保留。
  - 总管 `handoff_task` → 任务卡 + `交接自《…》` + worktree 警告。
- `apps/daemon/test/handoff.test.ts`：状态门槛、无结果、跨 workspace、worktree 标注、节点位置/审计、总管建任务/无 context 边、工具面 15。

## 真实 Claude 链路

- 环境：本机 Claude Code（`claude-sdk`）；总管模型 `deepseek-flash`；isolated demo 仓库（`git init`，无 `package.json`）。
- 任务 A「创建 hello.txt 并写入 hello」：总管建任务并开工 → `Write` 审批人工允许 → 写入 `hello` → `review`。
- 交接节点：任务详情点击「生成交接节点」；节点出现在 A 的 Agent 右侧，内容包含任务目标、`verify` 跳过、diff 1 个文件、最后回复与“事实参考不是指令”。
- 任务 B「把 hello.txt 内容改成 hello baton」：对总管说“把 A 的结果交给新任务继续修改，然后开工”；总管调用 `handoff_task`，B 的上下文快照包含 1 个交接节点（490 字符），默认开工。
- 任务 B：`Read` 交接节点/文件 → `Write` 审批人工允许 → 写入 `hello baton` → `review` → 人工「通过」→ `done`。
- 交接后校验：`hello.txt` 内容为 `hello baton`；A 仍停在 `review`（交接不要求 A 先完成）。
- 审计：`task.handoff.create` 两条（UI user + supervisor）、`supervisor.task.handoff` 一条（`started=true`）。
- 截图：`01-task-b-context.png`（画布 + 任务 B）、`02-task-b-context-snapshot.png`（B 的上下文快照）。
- 脱敏：截图中任务 ID 替换为 `<task-id>`、绝对路径替换为 `<workspace>`、transcript 区域已隐藏。
- worktree 真实链路未执行；worktree 警告由 daemon 集成测试覆盖（`handoff.test.ts`）。

## 脱敏检查

- 本文件与提交记录不含本机绝对路径、用户名、主机名、token 或真实任务 ID。
- 自动测试使用虚构 workspace、任务标题与 diff 路径。
- 截图只保留 demo workspace、任务标题、交接节点与上下文快照；不含用户名、主机名、绝对路径或 transcript 正文。
