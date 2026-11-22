# 0010. 移除产品内的 fake 引擎

- 状态：已采纳
- 日期：2026-11-22

## 背景

`fake` 是最早期用于打通调度闭环的脚本化引擎，会固定输出文本、发起一次 `Bash pnpm test` 审批然后结束。它不执行真实 Agent 工作，但会作为任务卡上的引擎出现在产品里；当 Claude SDK 不可用时，旧逻辑还会静默回落到 `fake`，容易让用户误以为任务真的在执行。

## 决策

- 从 `Engine` 枚举、引擎注册表、适配器工厂、默认引擎和前端引擎选择中移除 `fake`。
- 删除 `packages/adapters/src/fake.ts` 与对应产品导出。
- 保留确定性调度测试：把脚本化适配器移到 `apps/daemon/test/helpers/scripted-adapter.ts`，仅测试代码引用，不进入产品构建。
- 新增 migration 0014，把历史 `task.engine`、`session.adapter`、Agent 节点数据以及相关 JSON 账本中的 `fake` 统一迁移为 `claude-sdk`。
- Claude SDK 不可用时不再静默回落；任务会以 `engine_unavailable` 明确失败。

## 后果

- 产品里只有真实引擎（`claude-sdk`，`pty` 仍为 v1 不支持），不会误建假任务。
- 单元/集成测试仍可在不联网、不消耗模型额度的情况下确定性覆盖审批、等待、失败、预算和验收流程。
- 真实 AI 只用于手工验收、dogfooding 与明确需要真实模型的 e2e，不进入默认 CI 单测链路。
- 旧数据库升级后，历史 fake 任务会被标记为 `claude-sdk`；它们不会自动重新执行，用户需要重新建任务或重新开工。
