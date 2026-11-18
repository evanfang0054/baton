# ADR 0006: M2-2a 契约实现校正

- **状态**：accepted
- **日期**：2026-11-19
- **关联**：`docs/specs/2026-11-19-m2-autopilot-design.md`、`docs/contracts/M2-autopilot-v0.contract.md`、`docs/plans/2026-11-19-m2-autopilot-contracts.md`

## 背景

M2-2a Plan 1 的实现评审发现四处需要把“设计意图”落成可执行契约的细节：

1. `NoticeListQuery.before` / `AuditListQuery.before` 走 query string，直接使用 `Timestamp` 会在运行时收到字符串而校验失败。
2. `AuditListQuery.actionPrefix` 需要限制字符集，避免把未受控字符串带进查询。
3. `effectiveAutopilot` 的安全判定在 `evaluateApproval`、`verify_fail` 和 helper 中出现多份，需要单一实现；Plan 1 还需要在 daemon 接线前保持 fail-closed。
4. session-runner 不能沿用启动时的 workspace trust 快照；撤销信任必须在下一次审批立即生效。

## 决策

1. `NoticeListQuery.before` 与 `AuditListQuery.before` 使用 `z.coerce.number().int().nonnegative().optional()`；响应里的 `nextBefore` 仍是 `Timestamp`。
2. `AuditListQuery.actionPrefix` 限制为 `^[a-z.]{1,64}$`；仓储层用 `gte/lt` 前缀范围而不是 `LIKE`，避免 `%`/`_` 通配。
3. core 统一提供 `canAutopilot({ workspaceTrusted, killSwitch })` 与 `effectiveAutopilot`；`PolicyContext` / `TransitionContext` 在 daemon 接线后使用必填布尔值，缺失即编译失败，不再依赖可选默认值。
4. `session-runner` 每次处理 approval 时通过 `task.workspaceId → getWorkspace` 读取当前 trust；不使用 session 启动快照。
5. `getSetting` 遇到损坏 JSON 不再静默返回 `null`；kill switch 的调用方必须把解析失败按“强制暂停”处理。

## 后果

- spec §5.4 的原始 `Timestamp`/无限制 `actionPrefix` 文本保留为当时的已批准设计；本 ADR 是后续实现校正，spec 顶部已回链。
- 契约 DoD 13 的“每次审批读取当前 trust”成为可测行为；新增 `session-runner-trust-dynamic.test.ts`。
- Plan 1 的 `pnpm verify` 保持全绿；Plan 2 仍需把静态 `killSwitch` 改成 getter 并接入持久化状态。
- 查询参数从字符串 coerced 为数字；破坏性变更只影响尚未实现的 API，不涉及已发布客户端。

## 备选方案

- **保持 `Timestamp` 并让路由手动 Number()**：重复且容易漏；拒绝。
- **用 `LIKE` + 手工转义**：需要额外 `ESCAPE` 子句；前缀范围更简单；拒绝。
- **继续用可选 context 字段**：能保持 Plan 1 绿，但失去了“忘记传安全事实”的编译期保护；拒绝。
- **session 启动时快照 trust**：实现简单，但撤销信任不生效；拒绝。

## 链接

- Spec：`docs/specs/2026-11-19-m2-autopilot-design.md`
- Contract：`docs/contracts/M2-autopilot-v0.contract.md`
- Plan：`docs/plans/2026-11-19-m2-autopilot-contracts.md`
- 测试：`apps/daemon/test/session-runner-trust-dynamic.test.ts`
