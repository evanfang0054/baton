# M5-3 上下文交接自动验收

- **日期**：2026-11-21
- **分支**：`feat/m5-3-context-handoff`
- **提交**：`325c1ab`（core 摘要）、`c9217b9`（protocol）、`d587624`（core 策略）、`0dd714e`（daemon）、`95a276d`/`14c0c30`（web）、`7a7820a`（e2e）
- **状态**：自动验收完成；真实 Claude + ego-lite 证据待执行

## 自动验证

- `pnpm verify:full`：protocol 119、core 140、adapters 27、web 204、daemon 294 tests；Playwright 37 条全绿。
- `pnpm pack:check`：ok。
- `apps/web/e2e/handoff.spec.ts`：
  - 任务详情点击「生成交接节点」→ WS `task.handoff` → 画布出现 `【交接】` 节点并刷新。
  - 总管 `handoff_task` → 任务卡 + `交接自《…》` + worktree 警告。
- `apps/daemon/test/handoff.test.ts`：状态门槛、无结果、跨 workspace、worktree 标注、节点位置/审计、总管建任务/无 context 边、工具面 15。

## 待补：真实 Claude + ego-lite

1. 任务 A 在 demo 仓库写文件 → `review`。
2. 任务详情生成交接节点；对总管说“把 A 的结果交给 B，继续修改，然后开工”。
3. B 读取交接节点与文件 → 修改 → `review`。
4. 记录 taskId、状态、审计 `task.handoff.create` / `supervisor.task.handoff` 与脱敏截图。
5. 截图检查：不含用户名、主机名、本机绝对路径、token、transcript 正文。

## 脱敏检查

- 本文件与提交记录不含本机绝对路径、用户名、主机名、token 或真实任务 ID。
- 自动测试使用虚构 workspace、任务标题与 diff 路径。
