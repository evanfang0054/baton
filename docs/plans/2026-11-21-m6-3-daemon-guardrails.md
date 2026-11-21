---
spec_ref: ../specs/2026-11-21-m6-3-acceptance-evidence-design.md
spec_topic: m6-3-acceptance-evidence
task_count: 6
estimated_phases: [tests, implementation, verification]
dod: "任务预算可设/可停/可提额；自动批准按任务累计上限；context.inject requestId 幂等"
status: completed
depends_on: 2026-11-21-m6-3-daemon-acceptance.md
---

# M6-3 Plan 3：daemon 预算、提额、批准上限与注入幂等

> **For agentic workers:** 使用 `agent-harness:subagent-driven-development`（推荐）或 `executing-plans` 按 task 执行。

**Goal:** 给已存在的任务生命周期加上刹车：任务级预算、`waiting_input(budget)`、提额新 run、自动批准次数上限、注入幂等。

**Architecture:** 预算花费从 `session.costUsd` 派生；start 前算剩余并传给 adapter；usage 事件复核；提额用 core `budget_raise` 回到 queued，下一次 start 追加 `<budget_resume>`；自动批准计数从 `approval.decidedBy='auto'` 派生；注入幂等复用 `context_json.injections[].requestId`，不建新表。

**Tech Stack:** Fastify 5 + WS、better-sqlite3/drizzle、vitest、FakeAdapter。

**Commit strategy:** 每个 task 末尾一次 commit。

---

### Task 1: 预算服务、配置与 start 守卫

Blocking: Plan 2
Slice type: tracer-bullet
Seam: start 前剩余预算

**Files:**
- Modify: `packages/protocol/src/config.ts`
- Modify: `apps/daemon/src/config.ts`
- Create: `apps/daemon/src/budget/service.ts`
- Modify: `apps/daemon/src/runtime/types.ts`（`StartSessionInput.maxBudgetUsd?`）
- Modify: `apps/daemon/src/runtime/session-runner.ts:372-447`
- Modify: `apps/daemon/src/db/repositories.ts`（insertTask/映射 budgetUsd）
- Test: `apps/daemon/test/budget-start.test.ts`

**Interfaces:**
- Produces: `getTaskBudgetState(db, taskId, config)` → `TaskBudgetSummary`；`getRemainingBudget(...): number`；`StartSessionInput.maxBudgetUsd?`；config `verifierBudgetUsd=0.5`、`maxTaskBudgetUsd=50`。

- [x] **Step 1: 写失败测试**

```ts
it('passes remaining budget to adapter and refuses at zero', async () => {
  const { runtime } = createTestRuntime({ useSessionRunner: true,
    adapters: createAdapterFactory({ fake: new FakeAdapter({ script: [{ kind: 'usage', costUsd: 1.6 }, { kind: 'finish' }] }) }) })
  const taskId = runtime.createTask({ budgetUsd: 2 } as never)
  // start → adapter receives maxBudgetUsd 2；usage 后 remaining 0.4
  expect(startSessions.at(-1)?.maxBudgetUsd).toBe(2)
  // 第二次 start 时 remaining 0.4；把 budget 调低到 1.6 → start 不拉起，状态 waiting_input(budget)
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/budget-start.test.ts`
Expected: FAIL。

- [x] **Step 3: 实现**

- `ConfigSchema` 加 `verifierBudgetUsd`（默认 0.5）、`maxTaskBudgetUsd`（默认 50）；daemon `config.ts` 读 `BATON_VERIFIER_BUDGET_USD`、`BATON_MAX_TASK_BUDGET_USD`。
- `budget/service.ts`：`sumWorkerCost(db, taskId)`（`session.costUsd` 排除 verifier task）、`getTaskBudgetState`（用 core `budgetState`）、`getRemainingBudget`。
- `repositories.insertTask`/映射加 `budgetUsd`。
- `StartSessionInput` 加 `maxBudgetUsd?`；`session-runner.start` 调 `getRemainingBudget`；<=0 时 `applyTransition(taskId, {type:'budget_exceeded'})` 并 return；否则把 `maxBudgetUsd` 传给 adapter。
- `TaskCreateInput.budgetUsd` 写入 task；验收员任务用 `config.verifierBudgetUsd`。

- [x] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/budget-start.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add packages/protocol/src/config.ts apps/daemon/src/config.ts apps/daemon/src/budget apps/daemon/src/runtime apps/daemon/src/db/repositories.ts apps/daemon/test/budget-start.test.ts
git commit -m "feat(daemon): 任务预算服务与 start 守卫"
```

---

### Task 2: usage 事件预算停与 SDK 错误映射

Blocking: Task 1
Slice type: tracer-bullet
Seam: usage 事件 → waiting_input(budget)

**Files:**
- Modify: `apps/daemon/src/runtime/session-runner.ts:234-370`（consume / usage / error）
- Test: `apps/daemon/test/budget-stop.test.ts`

**Interfaces:**
- Produces: usage 更新后若 `spent >= budget` 且 task `running` → `applyTransition budget_exceeded` + interrupt；SDK budget error → `budget_exceeded`，不落 `error`。

- [x] **Step 1: 写失败测试**

```ts
it('stops at 100% and keeps the workspace', async () => {
  const adapter = new FakeAdapter({ script: [{ kind: 'usage', costUsd: 2, turns: 1 }, { kind: 'finish' }] })
  const { runtime } = createTestRuntime({ useSessionRunner: true, adapters: createAdapterFactory({ fake: adapter }) })
  const taskId = runtime.createTask({ budgetUsd: 2 } as never)
  await runtime.startTask(taskId)
  expect(getTask(db, taskId)).toMatchObject({ status: 'waiting_input', waitingReason: 'budget' })
  expect(interrupts).toContain(taskId)
})

it('maps SDK budget errors to budget_exceeded', async () => {
  const adapter = new FakeAdapter({ script: [{ kind: 'error', message: 'Exceeded USD budget' }] })
  // start with budget 0.1 → waiting_input(budget)，not failed
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/budget-stop.test.ts`
Expected: FAIL。

- [x] **Step 3: 实现**

- `consume` 的 usage 分支：`updateSessionUsage` 后读 `getTaskBudgetState`；over 且 task `running` → `applyTransition budget_exceeded`；`interrupt`。
- 错误分支：如果错误消息匹配 `budget|maxBudget|cost limit`，走 `budget_exceeded`；否则保持 `error`。
- `completed` 已到 `verifying` 时不再发 `budget_exceeded`（状态检查）。

- [x] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/budget-stop.test.ts test/session-usage.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add apps/daemon/src/runtime/session-runner.ts apps/daemon/test/budget-stop.test.ts
git commit -m "feat(daemon): 预算耗尽停任务与错误映射"
```

---

### Task 3: `task.set_budget`、提额与新 run 提示

Blocking: Task 1, Task 2
Slice type: tracer-bullet
Seam: WS 命令 → budget_raise → queued → `<budget_resume>`

**Files:**
- Create: `apps/daemon/src/runtime/budget-command.ts`
- Modify: `apps/daemon/src/runtime/index.ts`（WS dispatch）
- Modify: `apps/daemon/src/runtime/session-runner.ts`（start 前拼 prompt suffix）
- Modify: `apps/daemon/src/db/repositories.ts`（updateTaskBudget）
- Test: `apps/daemon/test/budget-raise.test.ts`

**Interfaces:**
- Produces: `handleTaskSetBudget(deps, input)`；允许 `todo/queued/waiting_input/failed`；`waiting_input(budget)` 且 `budgetUsd > spent` → 更新 + `budget_raise` → queued + `enqueuedAt` + audit；下一次 start 拼 `<budget_resume previous_usd budget_usd>`。

- [x] **Step 1: 写失败测试**

```ts
it('raises budget and starts a new run with budget_resume', async () => {
  const res = await send('task.set_budget', { taskId, budgetUsd: 3 })
  expect(res.ok).toBe(true)
  expect(getTask(db, taskId).status).toBe('queued')
  await drainScheduler()
  expect(startSessions.at(-1)?.prompt).toContain('<budget_resume previous_usd="2.00" budget_usd="3.00">')
})

it('rejects budget below spent', async () => {
  await expect(send('task.set_budget', { taskId, budgetUsd: 1.5 })).rejects.toMatchObject({ code: 'budget_below_spent' })
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/budget-raise.test.ts`
Expected: FAIL。

- [x] **Step 3: 实现**

- `updateTaskBudget(tx, id, budgetUsd)`；`setTaskEnqueuedAt` 在 `budget_raise` 后设置。
- `handleTaskSetBudget`：校验状态/数值；`waiting_input(budget)` 调 core `canRaiseBudget`；更新预算；`applyTransition budget_raise`；audit `task.budget.raise`。
- `pendingBudgetResume(db, taskId)`：取最近 `task.budget.raise` audit，若比最近 session `startedAt` 新，返回 note；`session-runner.start` 把它拼到 prompt 末尾，并写一次 audit `task.budget.resume`（不把 note 写回 task.prompt）。
- 非 budget 状态只改预算，不恢复。

- [x] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/budget-raise.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add apps/daemon/src/runtime apps/daemon/src/db/repositories.ts apps/daemon/test/budget-raise.test.ts
git commit -m "feat(daemon): 提额恢复与新 run 提示"
```

---

### Task 4: 自动批准次数上限

Blocking: Task 1
Slice type: tracer-bullet
Seam: `handleApproval` 自动批准前计数

**Files:**
- Modify: `packages/protocol/src/policy.ts`（`maxAutoApprovalsPerTask` 默认 10）
- Modify: `packages/protocol/src/automation.ts`（patch/summary 可选）
- Modify: `apps/daemon/src/runtime/session-runner.ts:126-232`
- Modify: `apps/daemon/src/db/repositories.ts`（`countAutoApprovals(db, taskId)`）
- Test: `apps/daemon/test/approval-cap.test.ts`

**Interfaces:**
- Produces: `countAutoApprovals`；`handleApproval` 在 `evaluateApproval` 返回 allow 且 `delegatedAuthority` 时，若 `autoApprovalCapReached` 为 true，则不自动批准，走人工 pending + audit `approval.cap_reached`。

- [x] **Step 1: 写失败测试**

```ts
it('auto-approves 10 then falls back to human', async () => {
  const script = Array.from({ length: 11 }, () => ({ kind: 'approval', request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' } as const }))
  // 前 10 个 approval decidedBy='auto'；第 11 个 decision=null，task waiting_input(approval)
  expect(listAudit(db, { actionPrefix: 'approval.cap_reached' })).toHaveLength(1)
})

it('cap 0 disables auto approval', async () => {
  // policy.maxAutoApprovalsPerTask=0 → 第一个 approval 就 pending
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/approval-cap.test.ts`
Expected: FAIL。

- [x] **Step 3: 实现**

- `PolicySchema.autopilot` 加 `maxAutoApprovalsPerTask: z.number().int().nonnegative().default(10)`；`AutomationPolicyPatch` 可选；`AutomationSummary` 返回。
- `countAutoApprovals`：`approval decidedBy='auto'` join `session` where `taskId`。
- `handleApproval`：在 auto allow 分支前计数；到顶 → 不自动决定，走 manual `approval_requested`，audit `approval.cap_reached`。
- kill switch/deny/trust 逻辑不变。

- [x] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/approval-cap.test.ts test/session-runner-approval.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add packages/protocol/src/policy.ts packages/protocol/src/automation.ts apps/daemon/src/runtime/session-runner.ts apps/daemon/src/db/repositories.ts apps/daemon/test/approval-cap.test.ts
git commit -m "feat(daemon): 自动批准按任务次数上限"
```

---

### Task 5: `context.inject` requestId 幂等

Blocking: Task 1
Slice type: tracer-bullet
Seam: 同 requestId 只写一次

**Files:**
- Modify: `packages/protocol/src/context.ts`（`ContextInjection.requestId`）
- Modify: `apps/daemon/src/db/repositories.ts:786-852`（`appendTaskContextInjection`）
- Modify: `apps/daemon/src/runtime/context-service.ts`
- Test: `apps/daemon/test/context-inject-idempotency.test.ts`

**Interfaces:**
- Produces: `findContextInjectionByRequestId(task, requestId)`；重复请求返回 `{ ok: true, duplicate: true, injection }`，不写 prompt/context/audit/WS。

- [x] **Step 1: 写失败测试**

```ts
it('writes one injection for the same requestId', async () => {
  await send('context.inject', { taskId, nodeIds: ['n1'], note: '补需求', requestId: 'req-1' })
  await send('context.inject', { taskId, nodeIds: ['n1'], note: '补需求', requestId: 'req-1' })
  const task = getTask(db, taskId)
  expect(task.context?.injections).toHaveLength(1)
  expect(audits.filter((a) => a.action === 'task.context.inject')).toHaveLength(1)
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/context-inject-idempotency.test.ts`
Expected: FAIL。

- [x] **Step 3: 实现**

- `ContextInjection` 加 `requestId: z.string().nullable().default(null)`。
- `context-service` 在装配前扫描 `task.context.injections`；命中同 requestId 直接返回已有；未命中继续。
- `appendTaskContextInjection` 写入 requestId；WS `context.injected` 事件不含正文，可带 requestId。
- 旧 injections 无 requestId 按 null 读取。

- [x] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/context-inject-idempotency.test.ts test/context-inject-command.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add packages/protocol/src/context.ts apps/daemon/src/db/repositories.ts apps/daemon/src/runtime/context-service.ts apps/daemon/test/context-inject-idempotency.test.ts
git commit -m "feat(daemon): 上下文注入 requestId 幂等"
```

---

### Task 6: Plan 3 集成回归

Blocking: Task 1-5
Slice type: verification
Seam: daemon 全量测试

- [x] **Step 1: 跑 daemon 全量测试**

Run: `pnpm --filter @evanfang0054/baton test`
Expected: PASS；`session-runner-approval`、`session-usage`、`context-inject-command` 不回归。

- [x] **Step 2: 跑 typecheck**

Run: `pnpm --filter @baton/protocol typecheck && pnpm --filter @baton/core typecheck && pnpm --filter @evanfang0054/baton typecheck`
Expected: PASS。

- [x] **Step 3: Commit（如有测试调整）**

```bash
git add apps/daemon/test packages/protocol/test
git commit -m "test(daemon): M6-3 预算/批准上限/注入幂等回归"
```

---

## 自检

- [x] 预算只算 worker session；验收员成本单独。
- [x] `waiting_input(budget)` 不落 failed；提额新 run 带 `<budget_resume>`，不写回 `task.prompt`。
- [x] 自动批准上限任务累计，retry/reopen 不重置；kill switch 优先。
- [x] 注入幂等不建新表；旧数据可读。
- [x] `pnpm --filter @evanfang0054/baton test` 全绿。

---

## 执行记录

- 2026-11-21：Task 1-6 完成。
- 提交：`1f1a459` 预算服务/start 守卫、`0d61a04` 预算停与错误映射、`8ab3ee1` 提额恢复、`e47dfce` 自动批准上限、`7e14932` 注入幂等。
- 验证：daemon 374 tests 全绿；`pnpm verify` 退出码 0（typecheck + lint + format + boundaries + protocol + tests + build）。
- 偏差：
  - `SessionRunnerDeps` 直接接收 `claudeMaxBudgetUsd`，start/usage 两处共用 `getTaskBudgetState`；验收员预算通过 `SupervisorServiceDeps.verifierBudgetUsd` 传给派单。
  - `task.create` 也校验 `maxTaskBudgetUsd`（`budget_too_large`），不只 `task.set_budget`。
  - `pendingBudgetResume` 用 `task.budget.raise` / `task.budget.resume` 审计时间比较，不依赖 session 起点；resume 只注入一次，不写回 `task.prompt`。
  - 预算由 core `budget_exceeded` 触发 `interruptSession`，session-runner 额外立即 interrupt 一次；适配器侧幂等。
  - `ContextInjection.requestId` 默认 null，旧快照无需迁移。