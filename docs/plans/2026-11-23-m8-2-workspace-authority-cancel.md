---
spec_ref: ../specs/2026-11-23-m8-attention-gate-authority-design.md
spec_topic: m8-attention-gate-authority
task_count: 4
estimated_phases: [tests, implementation, verification]
dod: "信任工作区 + autopilot + kill switch 关闭时非 deny 审批自动 allow 并写 authority 审计；deny 优先；交付取消幂等并级联；总管 cancel_delivery 二次确认；交付画布/看板可停止交付；pnpm verify 全绿"
status: completed
depends_on: 2026-11-23-m8-1-budget-removal.md
---

# M8-2 工作区授权与交付取消实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement task-by-task. Steps use `- [ ]` syntax for tracking.

**Goal:** 把审批噪音降为「非 deny 自动放行」，并让交付取消成为完整、可级联、可幂等的一等动作。

**Architecture:** 授权仍是 core 纯函数求值，daemon 只负责喂上下文与写审计；交付取消复用 `delivery.cancelledAt`，新增幂等标记入口，任务取消在 runtime 统一级联；总管新增 `cancel_delivery` 但仍不能 approve/reject。

**关键边界：** deny 永远优先；不设置 Claude `bypassPermissions`；不删除 artifact/annotation/画布节点。

---

### Task 1: Core 工作区授权与 deny 扩充

Blocking: none  
Slice type: feature  
Seam: `evaluateApproval` 纯函数

**Files:**
- Modify: `packages/core/src/policy/types.ts`
- Modify: `packages/core/src/policy/evaluate.ts`
- Modify: `packages/protocol/src/policy.ts`
- Test: `packages/core/test/policy.test.ts`

**Interfaces:**
- `PolicyContext.workspaceAuthority?: boolean`
- `PolicyDecision.authority?: 'workspace' | 'delegated'`
- `evaluateApproval` 顺序：deny → delegated → workspace authority → allow → ask。

- [ ] **Step 1: 写失败测试**

在 `packages/core/test/policy.test.ts` 增加：
- trusted + autopilot on + killSwitch false + `workspaceAuthority: true` 时，未命中 allow 的高风险 Bash 也返回 allow、`authority: 'workspace'`、`reason: 'workspace authority'`。
- deny 规则仍优先（`rm -rf /tmp/demo`）。
- 未信任、autopilot 关闭、kill switch 打开时仍 ask。
- `workspaceAuthority` 未开启时不生效。
- 默认 deny 覆盖 `.ssh`、`.aws`、`.gnupg`、系统目录写入、`mkfs`、`dd`、`sudo`、`rm -rf`、`curl | sh`、`git push`。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @baton/core exec vitest run test/policy.test.ts`

- [ ] **Step 3: 实现**

- `PolicyContext` 增加 `workspaceAuthority`；`PolicyDecision` 增加 `authority`。
- `evaluateApproval` 在 delegated 之后、allow 之前加入 workspace 分支，条件复用 `canAutopilot`。
- `packages/protocol/src/policy.ts` 扩充 `DEFAULT_DENY`。

- [ ] **Step 4: 验证并提交**

Run: `pnpm --filter @baton/core test && pnpm --filter @baton/protocol test`  
Commit: `feat(core): add workspace authority approval policy`

---

### Task 2: Daemon 接入工作区授权与审计

Blocking: Task 1  
Slice type: feature  
Seam: approval 事件处理

**Files:**
- Modify: `apps/daemon/src/runtime/session-runner.ts`
- Test: `apps/daemon/test/session-runner-approval.test.ts`
- Test: `apps/daemon/test/runtime-e2e.test.ts`（如需断言审计）

**Interfaces:**
- `evaluateApproval` 调用传入 `workspaceAuthority: true`。
- `approval.auto_allow` 审计 detail 含 `toolName`、`risk`、`policyVersion`、`authority=workspace`（仅工作区授权时）。
- adapter start 的 `permissionMode` 与 `allowDangerouslySkipPermissions` 不变。

- [ ] **Step 1: 写失败测试**

- 信任 workspace + autopilot + `workspaceAuthority` 下，高风险 Bash 审批自动 allow，且无 pending approval；审计 detail 含 `authority: 'workspace'`、`toolName`。
- kill switch 打开时回到 waiting_input(approval)。
- deny 命令仍 deny 且写 `approval.auto_deny`。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/session-runner-approval.test.ts`

- [ ] **Step 3: 实现**

- session-runner 传 `workspaceAuthority: true`，审计 detail 增加 `toolName` 与可选 `authority`。
- 不修改 `bypassPermissions` 计算。

- [ ] **Step 4: 验证并提交**

Run: `pnpm --filter @evanfang0054/baton test`  
Commit: `feat(daemon): apply workspace authority to approvals`

---

### Task 3: 交付取消幂等、级联与总管工具

Blocking: Task 2  
Slice type: feature  
Seam: delivery service + runtime cancel + supervisor tools

**Files:**
- Modify: `apps/daemon/src/delivery/service.ts`
- Modify: `apps/daemon/src/runtime/index.ts`
- Modify: `apps/daemon/src/http/deliveries.ts`
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Modify: `apps/daemon/src/supervisor/prompt.ts`
- Modify: `packages/core/src/supervisor/policy.ts`
- Modify: `packages/protocol/src/api.ts`
- Test: `apps/daemon/test/delivery-service.test.ts`
- Test: `apps/daemon/test/supervisor-delivery-tools.test.ts`
- Test: `packages/core/test/supervisor-policy.test.ts`

**Interfaces:**
- `markDeliveryCancelled(deliveryId, { actor, reason, source, taskId? })` 幂等，返回 `{ ok, changed, taskId }`。
- `cancelDelivery` 已取消时返回 ok + `taskId: null`；`DeliveryActionResponse.taskId` 改为 nullable。
- runtime `cancel` 成功后若任务有 `deliveryId` 且 `stageKey`，调用 `markDeliveryCancelled(..., source: 'task_cancel')`。
- supervisor 第 29 个工具 `cancel_delivery({ deliveryId, confirm? })`；未确认返回 `confirmation_required`；确认后取消并审计 `supervisor.delivery.cancel`。

- [ ] **Step 1: 写失败测试**

- 重复 `cancelDelivery` 返回 ok 且 `changed=false`。
- 取消阶段任务后交付 `cancelledAt` 非空、status cancelled、currentStageKey null；artifact/annotation 数量不变。
- `cancel_delivery` 首次返回 `confirmation_required`，`confirm=true` 后取消当前任务并写审计；重复确认幂等。
- `SUPERVISOR_POLICY.allowedTools` 含 `cancel_delivery` 且长度 29。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/delivery-service.test.ts test/supervisor-delivery-tools.test.ts`

- [ ] **Step 3: 实现**

- delivery service 抽 `markDeliveryCancelled`，`cancelDelivery` 使用它；emit `delivery.updated`。
- runtime `cancel` 级联；`DeliveryActionResponse.taskId` nullable；HTTP 路由 taskId 为空时不再发 task.cancel。
- supervisor tool/prompt/policy 同步 29 个工具。

- [ ] **Step 4: 验证并提交**

Run: `pnpm --filter @evanfang0054/baton test && pnpm --filter @baton/core test`  
Commit: `feat(daemon): add delivery cancel cascade and supervisor tool`

---

### Task 4: Web 停止交付入口

Blocking: Task 3  
Slice type: feature  
Seam: delivery canvas/card

**Files:**
- Modify: `apps/web/src/features/deliveries/DeliveryCanvas.tsx`
- Modify: `apps/web/src/features/deliveries/DeliveryCard.tsx`
- Modify: `apps/web/src/features/deliveries/DeliveryBoard.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/features/deliveries/DeliveryBoard.test.tsx`
- Test: `apps/web/src/features/deliveries/DeliveryCanvas.test.tsx`（新建，若无）

**Interfaces:**
- `onCancelDelivery(deliveryId)` 由 App 提供：`window.confirm` → `cancelDelivery` → 失效 `deliveries/delivery/deliveryCanvas/tasks`；失败 toast。
- 已取消交付不渲染「停止交付」。

- [ ] **Step 1: 写失败测试**

- 画布顶部出现「停止交付」，确认后调用回调。
- 看板卡片出现「停止交付」，点击不触发展开交付。
- cancelled 交付不显示该按钮。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/deliveries`

- [ ] **Step 3: 实现**

- 增加按钮与确认；卡片避免嵌套 button（根容器改 role=button 或按钮分离）。
- App 接入 API 与 query 失效。

- [ ] **Step 4: 验证并提交**

Run: `pnpm --filter @baton/web typecheck && pnpm --filter @baton/web test`  
Commit: `feat(web): add stop delivery controls`

---

## Plan 完成定义

- 工作区授权按 spec 生效，deny 优先，审计含 authority/toolName。
- 交付取消幂等、任务取消级联、总管二次确认。
- 画布与看板都有停止交付入口。
- `pnpm verify` 全绿，四个 task 各自有 commit。
