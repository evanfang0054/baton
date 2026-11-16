# Sprint Contract: M1-1/M1-2 协议领域模型与状态机

> 关联 spec：`docs/specs/2026-11-17-m1-protocol-state-machine-design.md`
> 文档位置说明：本仓库 contract 落 `docs/contracts/`，不使用 `docs/agent-harness/contracts/`。

## Outcome（用户视角）

这一轮结束后，后续做 daemon、画布和验收卡的人不需要再猜任务状态或事件字段：他们能直接从 `@baton/protocol` 拿到任务、节点、审批、验收的类型，从 `@baton/core` 拿到唯一的任务转移函数。任何一个任务状态变化都能用测试证明它从哪来、到哪去、触发哪些后续动作；非法转移和并发越界会被明确拒绝，而不是悄悄改状态。

## Definition of Done

- [ ] **1. 协议导出完整**：`packages/protocol/src/index.ts` 导出 spec 4.2–4.9 列出的全部枚举、实体、`TaskTransitionEvent`、6 个命令、6 个事件、`AppError`、`PolicySchema`、`AgentEvent`、`EventType`、`EventSchemas`；现有 `ConfigSchema`、`HealthResponse`、`WsEnvelope`、`WsPing`、`WsPong` 保持不变。
- [ ] **2. 导出契约测试**：新增 `packages/protocol/test/exports.test.ts`，逐个 import 上述运行时 schema 并断言可 parse；tsc 编译通过。
- [ ] **3. 实体 schema 完整**：Workspace、Canvas、Node（六类判别联合）、Edge、Task、Session、Event、Approval、Review、Audit、Notice 均有合法 fixture 测试与非法 fixture 测试。
- [ ] **4. 节点联合可判别**：六类节点的 `type` 与 `data` 正确窄化；错配（例如 `type: 'text'` 配 `{ src }`）被拒绝；`group.collapsed` 默认 false。
- [ ] **5. Review 语义正确**：`Review.verdict` 只接受 `approved | rejected | null`；`passed/failed` 被拒绝；verify 结果只能通过 `verifyExitCode` 表达。
- [ ] **6. 事件游标正确**：`Event` 必须同时有非负整数 `ordinal` 与 `seq`；缺任一或负数被拒绝。
- [ ] **7. 状态转移事件完整**：12 个 `TaskTransitionEvent` 全部 round-trip；`verify_ok.exitCode` 强制 0；`verify_fail.exitCode` 强制非 0；`reject.feedback` 非空。
- [ ] **8. WS 命令完整**：`resume`、`task.create`、`task.enqueue`、`task.cancel`、`approval.decide`、`review.decide` 全部 round-trip；`review.decide` 的 approve/reject 判别分支正确，reject 缺 feedback 被拒绝。
- [ ] **9. WS 事件完整**：`ack`、`error`、`task.status`、`session.event`、`approval.request`、`verify.result` 全部 round-trip；`session.event` 的 `event` 字段通过官方 AG-UI `EventSchemas` 校验。
- [ ] **10. AG-UI 集成**：`@ag-ui/core@^1.0.4` 加入 `packages/protocol` 依赖；至少一个真实 `TEXT_MESSAGE_CONTENT` fixture 通过官方 schema；没有手写第二套 Agent 事件类型。
- [ ] **11. PolicySchema 默认值**：空对象 parse 后 `timeoutSec=900`、`maxOutputBytes=262144`、`approval.default='ask'`、`autoApproveMaxRisk='low'`、`autopilot.enabled=false`、`autopilot.retryMax=2`、`digestCron='0 9,21 * * *'`；非法 risk 与负 `retryMax` 被拒绝。
- [ ] **12. AppError 形状**：`AppError` 接受 `{ code, message }` 与可选 `details`；缺 code/message 被拒绝。
- [ ] **13. 状态机 API 可用**：`packages/core/src/state-machine/index.ts` 导出 `transition`、`TransitionContext`、`TaskEffect`、`TransitionResult`；`transition` 为同步纯函数，不 import `node:*`、不访问 IO。
- [ ] **14. 转移矩阵完整**：9 个状态 × 12 个事件类型 = 108 个组合；表驱动测试逐一断言“合法转移的 `to/effects`”或 `invalid_transition`，没有未覆盖组合。
- [ ] **15. 四条流程快照**：happy path、approval allow/deny、verify_fail 自动重试、reject 的 effects 序列各有快照；顺序与 spec 5.2 一致。
- [ ] **16. 守卫语义**：`start` 在 `runningCount >= maxConcurrency` 时返回 `guard_failed`，在小于时返回 `running` + `startSession`；`verify_fail` 在 autopilot 关闭或 `retryCount >= retryMax` 时进 `review`，不返回 `guard_failed`。
- [ ] **17. 计数语义**：`verify_fail` 实际重试时 `retryCount + 1` 且 effects 含 `incrementRetry`；`reject` 后 `retryCount` 不变且 effects 不含 `incrementRetry`。
- [ ] **18. 终态语义**：`done/failed/cancelled` 对任意事件返回 `invalid_transition`；`cancel` 从 `review` 返回 `cancelled` 且不产生 `interruptSession`；`cancel` 从 `running` 产生 `interruptSession`；`error` 从 `waiting_input` 进 `failed`。
- [ ] **19. 状态广播唯一**：每个成功转移恰好产生一条 `emitTaskStatus`；失败转移不产生 effects。
- [ ] **20. 分层与依赖**：`packages/core` 只依赖 `@baton/protocol`；`pnpm check:boundaries` 与 `pnpm check:protocol` 通过；core 的 `package.json` 没有除 `@baton/protocol` 外的运行时依赖。
- [ ] **21. 覆盖率达标**：`packages/core` 增加 `vitest` + `@vitest/coverage-v8@^5.1.0` 与覆盖率阈值 80%（lines/functions/branches/statements）；`pnpm --filter @baton/core test` 低于阈值时非 0 退出。
- [ ] **22. 全量校验**：`pnpm verify`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全部退出码 0。
- [ ] **23. 变更边界**：`git diff --name-only origin/main...HEAD -- apps` 为空；实现改动只落在 `packages/protocol/**`、`packages/core/**`、`docs/specs/2026-11-17-m1-protocol-state-machine-design.md`、`docs/contracts/M1-protocol-state-machine.contract.md`、`docs/plans/2026-11-17-m1-protocol-state-machine.md`、`docs/README.md`、`THIRD_PARTY_NOTICES.md`、`pnpm-lock.yaml`、`.gitignore`。说明：`.gitignore` 是实现期补充的 allowed path，仅用于忽略 `coverage/` 产物。
- [ ] **24. 文档与许可**：`THIRD_PARTY_NOTICES.md` 包含 `@ag-ui/core`；新增 `@vitest/coverage-v8` 已列入开发依赖声明；spec/contract/plan 互相链接。
- [ ] **25. 无占位实现**：`packages/protocol/src` 与 `packages/core/src` 中无 `TODO`/`FIXME`；未完成能力没有以空实现混入。

## Boundary Conditions

- **Must support**：Node 22 与 24；pnpm 10；TypeScript strict；现有 M0 的 `ping/pong`、`/api/health`、`ConfigSchema` 行为不变。
- **Must not break**：M0 的 daemon/web/CI；协议信封 `v: 1`；已有导出；M0 测试。
- **Dependency**：新增运行时依赖只有 `@ag-ui/core`（MIT）；core 不新增运行时依赖（内部 `@baton/protocol` 除外）；不引入 GPL/AGPL/Sustainable Use。
- **Security**：core 无 IO、无 shell、无文件路径、无凭据；协议不引入真实 token/路径/个人信息。
- **Performance**：`transition` 同步、无 IO、无全局可变状态；108 组合测试在本地 5 秒内完成。
- **Scope**：不实现 daemon repository/service、web UI、adapter、context assembler、policy 求值、DB migration、REST DTO。

## Acceptance Criteria

### Computational

以下命令均以退出码 0 为准：

```bash
pnpm verify
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
pnpm --filter @baton/core test
pnpm --filter @baton/protocol test
git diff --name-only origin/main...HEAD -- apps   # 输出必须为空
```

覆盖率以 `@vitest/coverage-v8` 的阈值为准：`packages/core` 的四项指标均 ≥ 80%。

### Inferential

- 人工对照 spec 5.2 与 `transition.ts`：每一行转移、guard、effects 一一对应，没有多出或遗漏。
- 人工对照 spec 4.2–4.9 与 `packages/protocol/src/index.ts`：导出清单完整，没有手写镜像类型。
- 人工评审 effects 词汇：每个 effect 都有明确消费者或测试断言，没有为“未来可能”预留的空 effect。
- 人工评审 `Review.verdict` 与 `verifyExitCode` 的使用：没有把机器结果写进人的决定字段。

## Negotiation Record

**Round 1 — Generator（初版，10 条）**

1. protocol 导出所有类型。
2. core 有 `transition`。
3. `pnpm verify` 通过。
4. protocol 有测试。
5. core 有测试。
6. core 覆盖率 ≥ 80%。
7. 加 `@ag-ui/core`。
8. 不改 daemon/web。
9. 更新文档。
10. 状态机覆盖 spec。

**Round 1 — Evaluator（挑战）**

- “导出所有类型”不可判定：必须列出确切导出，并用 import 测试证明。
- “有测试”不可判定：必须给出实体/命令/事件/转移的测试数量与矩阵。
- “不改 daemon/web”不可判定：必须给出 `git diff --name-only ... -- apps` 的空输出。
- “覆盖率 ≥ 80%”不可判定：必须绑定 coverage 工具与四项阈值。
- “状态机覆盖 spec”不可判定：必须写成 9 × 12 的完整矩阵，而不是抽样。

**Round 2 — Generator（修订，18 条）**

- 加入 `exports.test.ts`、实体/节点/Review/Event/Transition/WS/Policy/AG-UI 的具体测试。
- 加入 108 组合矩阵、四条 effects 快照、守卫与终态测试。
- 加入 allowed paths、coverage 命令、`check:boundaries`、`check:protocol`。
- 加入 `Review.verdict` 与 `verifyExitCode` 的拆分测试。

**Round 2 — Evaluator（再次挑战）**

- `verify_fail` 的重试分支没有说明是否算 `guard_failed`：必须明确“分支而非错误”。
- `reject` 的 `retryCount` 语义没有测试：必须断言不变且无 `incrementRetry`。
- `emitTaskStatus` 可能被 daemon 重复发送：必须断言每个成功转移恰好一条。
- `cancel` 在 `review` 与 `running` 的 effects 不同：必须分别断言。
- `error` 从 `waiting_input` 进 `failed` 是 spec 的扩展：必须有测试。
- `@ag-ui/core` 的接入不能只看依赖：必须有一个真实事件 fixture 通过官方 schema。
- 变更边界必须包含 specs/contracts/plans/README/notices/lockfile，不能只写“不改 apps”。

**Round 3 — Generator（最终，25 条）**

- 接受以上全部挑战，写入第 1–25 条。
- 明确 `verify_fail` 重试是分支；`reject` 不计数；`emitTaskStatus` 唯一；`cancel` 分状态；`error` 从 `waiting_input` 允许；AG-UI fixture；allowed paths 完整。
- 明确 `Review.verdict` 只表示人的决定，verify 看 `verifyExitCode`。

**Final consensus**

25 条 DoD，3 轮 generator-evaluator，无剩余挑战。验收以命令退出码、测试矩阵与人工对照 spec 为准。

## Out of Scope（本 contract 不验收）

- daemon 的 task service、event store、WS 路由、verify 执行器。
- web 的画布、看板、验收卡、WS 客户端。
- `packages/adapters` 与 `agent-fake` / `agent-claude`。
- 上下文装配与 policy 求值。
- `event.ordinal` migration 与 `BATON_MAX_CONCURRENCY` 环境变量解析。
- REST DTO、画布 WS 命令、`canvas.patch`、`notice`。
