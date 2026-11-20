# ADR 0009：总管预验收，最终验收仍由人决定

- **状态**：Accepted（2026-11-20）
- **日期**：2026-11-20
- **关联**：`docs/adr/0008-supervisor-delegated-authority.md`、`docs/specs/2026-11-20-m4-supervisor-secretary-design.md`
- **取代**：ADR 0008 中的“代验收”部分

## 背景

ADR 0008 曾把验收闸门也委派给总管：验收员 PASS + verify 0 时自动 approve。用户随后明确纠正：

> 结束只能由我来。没有任何报告能让任务变成“已完成”，agent 说做完了，只会让它进“待验收”。总管派的子代理去验收只是初步验收，最终验收需要我来判决和验证。

这与 `baton.ai` 中 CanvasAgents 的硬规则一致：**结束只能由我来**；Router 只调度，不替老板过闸门。

## 决定

- 总管任务进入 `review` 时，仍然派独立验收员 Agent 做**初步验收**。
- 验收员只输出建议（PASS/FAIL + 理由），不得改动目标任务状态。
- 目标任务始终停在 `review`；只有人 approve 才进入 `done`，人 reject 则打回重跑。
- 删除 `autopilot.delegatedAcceptance` 和所有自动 approve 路径；保留 `autopilot.delegatedAuthority`（高风险工具自动批准）不变。
- 审计改为 `supervisor.review.recommend`，记录 verdict、verify 退出码、reviewId、verifierTaskId、policyVersion；不再产生 `supervisor.review.accept`。
- worktree 任务仍由验收员复用目标 worktree 做初步检查。

## 后果

- 好处：恢复“结束只能由我来”，老板保有最终判决权；初步验收仍然减少人工排查成本。
- 代价：每个任务仍需人点一次通过/打回；这是有意保留的闸门。
- 风险：验收员结论可能不准确，但不影响状态机；人仍然掌握最终决定。
