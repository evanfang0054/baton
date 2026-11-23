---
spec_ref: ../specs/2026-11-23-m8-attention-gate-authority-design.md
spec_topic: m8-attention-gate-authority
status: active
---

# M8 注意力闭环实施执行图

> 对应 spec：`docs/specs/2026-11-23-m8-attention-gate-authority-design.md`
> 对应 contract：`docs/contracts/M8-attention-gate-authority.contract.md`
> 这是目录级执行图；每个 plan 独立确认、独立验证、独立提交。

## 计划拆分

| #   | Plan | 产出 | 依赖 | 验证门 |
| --- | --- | --- | --- | --- |
| 1 | `2026-11-23-m8-1-budget-removal.md` | 预算从 UI/daemon/core/protocol/DB 彻底移除；migration 0016；内部 cost/turn 保留 | 无 | `pnpm verify` + migration 0016 测试 |
| 2 | `2026-11-23-m8-2-workspace-authority-cancel.md` | workspace authority policy + 审计；交付取消 UI/总管工具/级联 | Plan 1 | policy/daemon/web 测试 + `pnpm verify` |
| 3 | `2026-11-23-m8-3-supervisor-gate-cards.md` | 总管会话闸门卡（审批/验收内联动作） | Plan 2 | web 组件 + Playwright + 截图 |
| 4 | `2026-11-23-m8-4-e2e-evidence.md` | Playwright、真实 ego 链路、证据与文档收口 | Plan 3 | `pnpm verify:full` + 真实 ego 证据 |

## 依赖链

```
M8-1 → M8-2 → M8-3 → M8-4
```

- M8-2 依赖 M8-1 清理后的 config/session-runner/policy context，避免预算与授权改动互相冲突。
- M8-3 依赖 M8-2 的取消/审批事件与稳定 workspace 授权。
- M8-4 最后做，汇总真实链路证据。

## 确认门

1. 每个 plan 结束：`pnpm verify` 全绿；本 plan 的测试与验收点通过；贴真实输出。
2. M8-2 结束：policy 授权/deny/kill switch 测试 + 交付取消级联测试通过。
3. M8-3 结束：审批卡/验收卡动作、override 理由、实时出现/消失通过；附桌面与移动端截图。
4. M8-4 结束：`pnpm verify:full`；真实 deepseek 总管 + 真实 Claude 链路；supervisor `toolCalls` 无 approve/reject/resolve。
5. 每个 plan 完成后把 frontmatter `status` 改为 `completed`，再创建下一个 plan；同一时间只保留 1 个 active plan。

## GDD

用户明确选择跳过正式 GDD；以 sprint contract 的 16 条 DoD + 每个 task 的 TDD/typecheck/e2e 作为 gate tree。若执行中出现跨层契约歧义，暂停并先补 GDD。

## 提交策略

用户选择每个 task 完成即 commit。每个 task 的 commit 必须可回滚，commit message 使用 Conventional Commits。

## 当前状态

- M8 spec：已批准并提交。
- M8 contract：已提交。
- M8-1 plan：已完成（预算移除 + migration 0016）。
- M8-2 plan：已完成（workspace authority + 交付取消）。
- M8-3 plan：已完成（总管会话闸门卡 + Playwright）。
- M8-4：active（全量验收 + 真实 ego 链路 + 证据）。
