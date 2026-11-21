---
spec_ref: ../specs/2026-11-21-m6-3-acceptance-evidence-design.md
spec_topic: m6-3-acceptance-evidence
task_count: 8
estimated_phases: [tests, implementation, verification]
dod: "protocol/core/migration 0012 全绿；AC/budget/report 纯函数与转移矩阵有测试；fake verifier 与 StartInput.maxBudgetUsd 可用"
status: completed
depends_on: none
---

# M6-3 Plan 1：protocol + core + migration 0012

> **For agentic workers:** 使用 `agent-harness:subagent-driven-development`（推荐）或 `executing-plans` 按 task 执行；每步用 checkbox 跟踪。

**Goal:** 先把 M6-3 的协议、纯函数、状态机与数据库基座做实，不接 daemon 业务、不改 web。

**Architecture:** 三张验收表 + `task.budget_usd`；AC 的摘要/编辑/克隆/报告都是 core 纯函数；预算与自动批准上限也是纯函数；状态机只新增 `budget_exceeded` / `budget_raise` 两个事件，不新增任务状态。验收员结构化输出与 fake 脚本在 adapter 层留好测试钩子。

**Tech Stack:** TypeScript ESM、zod 4、drizzle-orm/sqlite、vitest、pnpm workspaces。

**Commit strategy:** 按仓库先例，每个 task 末尾一次 commit；如果你想最后统一提交，执行前告诉我。

---

### Task 1: Protocol 验收实体与 Task 字段

Blocking: none
Slice type: tracer-bullet
Seam: zod schema 解析 + 类型导出

**Files:**
- Create: `packages/protocol/src/entities/acceptance.ts`
- Modify: `packages/protocol/src/entities/index.ts`, `packages/protocol/src/index.ts`, `packages/protocol/src/enums.ts`, `packages/protocol/src/entities/task.ts`, `packages/protocol/src/api.ts`
- Test: `packages/protocol/test/acceptance.test.ts`

**Interfaces:**
- Produces: `AcceptanceItemStatus`, `AcceptanceVerdict`, `AcceptanceContractStatus`, `AcceptanceRunStatus`, `AcceptanceContract`, `AcceptanceItem`, `AcceptanceRun`, `AcceptanceCounts`, `TaskAcceptanceSummary`, `TaskBudgetSummary`, `AcceptanceReportFacts`, `AcceptanceReport`; `WaitingReason` includes `'budget'`; `Task.budgetUsd`; `TaskSummary.acceptance/budget`.

- [x] **Step 1: 写失败测试**

```ts
// packages/protocol/test/acceptance.test.ts
import { describe, expect, it } from 'vitest'
import {
  AcceptanceContract,
  AcceptanceItem,
  AcceptanceReport,
  AcceptanceRun,
  Task,
  TaskSummary,
} from '../src/index.js'

it('parses a draft contract with items', () => {
  expect(AcceptanceContract.parse({
    id: 'ac1', taskId: 't1', version: 1, status: 'draft',
    createdBy: 'verifier', revision: 0, truncated: false,
    createdAt: 1, frozenAt: null,
  }).status).toBe('draft')
})

it('accepts 0 items and rejects 9', () => {
  expect(AcceptanceItem.array().parse([])).toEqual([])
  expect(() => AcceptanceItem.array().parse(Array.from({ length: 9 }, (_, i) => ({
    id: `i${i}`, contractId: 'ac1', ordinal: i + 1, text: 'x',
    status: 'pending', evidence: null, source: 'verifier', updatedAt: 1,
  })))).toThrow()
})

it('task summary defaults acceptance/budget to null', () => {
  const parsed = TaskSummary.parse({
    id: 't1', workspaceId: 'w1', nodeId: null, title: 't', prompt: 'p',
    status: 'review', waitingReason: null, engine: 'fake', workspaceMode: 'main',
    branch: null, worktreePath: null, verifyCommand: null, retryCount: 0,
    dangerouslySkipPermissions: false, enqueuedAt: null, createdAt: 1, updatedAt: 2,
    attention: 'needs_review', waitingSince: 1,
  })
  expect(parsed.acceptance).toBeNull()
  expect(parsed.budget).toBeNull()
  expect(Task.parse({ ...parsed, budgetUsd: null }).budgetUsd).toBeNull()
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/protocol exec vitest run test/acceptance.test.ts`
Expected: FAIL，`AcceptanceContract` 未导出。

- [x] **Step 3: 最小实现**

在 `entities/acceptance.ts` 定义：

```ts
export const AcceptanceItemStatus = z.enum(['pending', 'pass', 'fail', 'waived'])
export const AcceptanceVerdict = z.enum(['pass', 'fail', 'incomplete'])
export const AcceptanceContractStatus = z.enum(['draft', 'frozen'])
export const AcceptanceRunStatus = z.enum(['running', 'complete', 'failed'])

export const AcceptanceContract = z.object({
  id: z.string(), taskId: z.string(), version: z.number().int().positive(),
  status: AcceptanceContractStatus, createdBy: z.enum(['verifier', 'human']),
  revision: z.number().int().nonnegative(), truncated: z.boolean(),
  createdAt: Timestamp, frozenAt: Timestamp.nullable(),
})

export const AcceptanceItem = z.object({
  id: z.string(), contractId: z.string(), ordinal: z.number().int().positive(),
  text: z.string().min(1).max(200), status: AcceptanceItemStatus,
  evidence: z.string().max(200).nullable(), source: z.enum(['verifier', 'human']),
  updatedAt: Timestamp,
})

export const AcceptanceRun = z.object({
  id: z.string(), taskId: z.string(), contractId: z.string(), reviewId: z.string(),
  verifierTaskId: z.string().nullable(), status: AcceptanceRunStatus,
  verdict: AcceptanceVerdict.nullable(), summary: z.string().max(1000).nullable(),
  createdAt: Timestamp, completedAt: Timestamp.nullable(),
})

export const AcceptanceCounts = z.object({
  total: z.number().int().nonnegative(), pass: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(), pending: z.number().int().nonnegative(),
  waived: z.number().int().nonnegative(),
})
```

`TaskAcceptanceSummary`、`TaskBudgetSummary`、`AcceptanceReportFacts`、`AcceptanceReport` 按 spec §7.1 定义；`AcceptanceReport = AcceptanceReportFacts.extend({ hash: z.string() })`。

- [x] **Step 4: 接入现有类型**

- `enums.ts` 的 `WaitingReason` 加 `'budget'`。
- `entities/task.ts` 的 `Task` 加 `budgetUsd: z.number().nonnegative().nullable().default(null)`。
- `api.ts` 的 `TaskSummary` 加 `acceptance: TaskAcceptanceSummary.nullable().default(null)`、`budget: TaskBudgetSummary.nullable().default(null)`。
- `entities/index.ts` 与 `index.ts` 导出新 schema。

- [x] **Step 5: 跑测试与 typecheck**

Run: `pnpm --filter @baton/protocol exec vitest run test/acceptance.test.ts && pnpm --filter @baton/protocol typecheck`
Expected: PASS。

- [x] **Step 6: Commit**

```bash
git add packages/protocol/src packages/protocol/test/acceptance.test.ts
git commit -m "feat(protocol): 验收合同/条目/运行与预算字段"
```

---

### Task 2: Protocol 命令、事件与转移类型

Blocking: Task 1
Slice type: tracer-bullet
Seam: `ClientMessage` / `ServerMessage` 解析

**Files:**
- Modify: `packages/protocol/src/commands.ts`, `packages/protocol/src/events.ts`, `packages/protocol/src/transitions.ts`, `packages/protocol/src/api.ts`
- Test: `packages/protocol/test/acceptance-commands.test.ts`

**Interfaces:**
- Produces: `AcceptanceUpdateInput`, `TaskSetBudgetInput`; `ContextInjectInput.requestId?`; `ReviewDecideInput.approve.overrideReason?`; `AcceptanceUpdatedEvent`; `TaskTransitionEvent` 增加 `budget_exceeded` / `budget_raise`。

- [x] **Step 1: 写失败测试**

```ts
it('parses acceptance.update and budget command', () => {
  expect(ClientMessage.parse({ v: 1, id: '1', ts: 1, type: 'acceptance.update',
    payload: { taskId: 't1', contractId: 'ac1', expectedRevision: 0,
      items: [{ text: '登录成功', status: 'pending' }] } }).type).toBe('acceptance.update')
  expect(ClientMessage.parse({ v: 1, id: '2', ts: 1, type: 'task.set_budget',
    payload: { taskId: 't1', budgetUsd: 3 } }).type).toBe('task.set_budget')
})

it('requires overrideReason on approve only when supplied', () => {
  expect(ReviewDecideInput.parse({ taskId: 't1', decision: 'approve', overrideReason: '已知风险' }).decision).toBe('approve')
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/protocol exec vitest run test/acceptance-commands.test.ts`
Expected: FAIL，命令未注册。

- [x] **Step 3: 实现命令**

- `ContextInjectInput` 加 `requestId: z.string().min(1).max(100).optional()`。
- `AcceptanceUpdateInput`：`{ taskId, contractId, expectedRevision, items: AcceptanceItemInput[] }`，`items` 允许 0-8，`text` 1-200，`evidence` 0-200。
- `TaskSetBudgetInput`：`{ taskId, budgetUsd: z.number().finite().positive() }`。
- `TaskCreateInput` 加 `budgetUsd: z.number().finite().positive().optional()`（验收员任务用）。
- `ReviewDecideInput` 的 approve 分支加 `overrideReason: z.string().max(2000).optional()`。
- `ClientMessage` union 加 `acceptance.update`、`task.set_budget`。

- [x] **Step 4: 实现事件与转移类型**

- `events.ts` 新增 `AcceptanceUpdatedEvent`（type `acceptance.updated`，payload `{ taskId, contractId, version, revision, status, counts, verdict }`），加入 `ServerMessage`。
- `transitions.ts` 的 `TaskTransitionEvent` 加 `{ type: 'budget_exceeded' }`、`{ type: 'budget_raise'; budgetUsd: number }`。

- [x] **Step 5: 跑测试与 typecheck**

Run: `pnpm --filter @baton/protocol exec vitest run test/acceptance-commands.test.ts && pnpm --filter @baton/protocol typecheck`
Expected: PASS。

- [x] **Step 6: Commit**

```bash
git add packages/protocol/src packages/protocol/test/acceptance-commands.test.ts
git commit -m "feat(protocol): 验收编辑/预算命令与验收事件"
```

---

### Task 3: Core AC 摘要、编辑校验、克隆

Blocking: Task 1
Slice type: tracer-bullet
Seam: 纯函数输入/输出

**Files:**
- Create: `packages/core/src/acceptance/constants.ts`, `summary.ts`, `update.ts`, `clone.ts`, `index.ts`
- Test: `packages/core/test/acceptance-core.test.ts`

**Interfaces:**
- Produces: `MAX_AC_ITEMS=8`, `MAX_AC_TEXT=200`, `MAX_AC_EVIDENCE=200`, `MAX_AC_TOTAL_CHARS=2000`; `acceptanceSummary(items)`; `validateAcceptanceUpdate({ items, expectedRevision, currentRevision })`; `cloneAcceptanceItems(items)`。

- [x] **Step 1: 写失败测试**

```ts
it('derives pass/fail/incomplete', () => {
  expect(acceptanceSummary([
    { status: 'pass' }, { status: 'waived' },
  ] as AcceptanceItem[]).verdict).toBe('pass')
  expect(acceptanceSummary([{ status: 'pass' }, { status: 'fail' }] as AcceptanceItem[]).verdict).toBe('fail')
  expect(acceptanceSummary([]).verdict).toBe('incomplete')
})

it('rejects revision mismatch and over-limit', () => {
  expect(validateAcceptanceUpdate({ items: [], expectedRevision: 1, currentRevision: 2 }))
    .toMatchObject({ ok: false, code: 'revision_conflict' })
  expect(validateAcceptanceUpdate({ items: Array.from({ length: 9 }, () => ({ text: 'x', status: 'pending' })), expectedRevision: 0, currentRevision: 0 }))
    .toMatchObject({ ok: false, code: 'too_many_items' })
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/core exec vitest run test/acceptance-core.test.ts`
Expected: FAIL，函数不存在。

- [x] **Step 3: 实现**

- `acceptanceSummary`：统计计数；`fail>0` → fail；`pending>0 || total===0` → incomplete；否则 pass。
- `validateAcceptanceUpdate`：条数 0-8、text 1-200、evidence 0-200、总文本 <=2000、状态枚举、revision 相等；错误返回 `{ ok:false, code, message, index? }`。
- `cloneAcceptanceItems`：保留 text，status=`pending`，evidence=null，source=`verifier`，ordinal 重排。
- `index.ts` 导出。

- [x] **Step 4: 跑测试**

Run: `pnpm --filter @baton/core exec vitest run test/acceptance-core.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add packages/core/src/acceptance packages/core/test/acceptance-core.test.ts
git commit -m "feat(core): AC 摘要/编辑校验/克隆纯函数"
```

---

### Task 4: Core 验收报告

Blocking: Task 1, Task 3
Slice type: tracer-bullet
Seam: 固定 input → 报告快照

**Files:**
- Create: `packages/core/src/acceptance/report.ts`
- Test: `packages/core/test/acceptance-report.test.ts`

**Interfaces:**
- Produces: `buildAcceptanceReport(input): { report: AcceptanceReportFacts; canonical: string }`；内部使用 `stableStringify`（`packages/core/src/policy/match.ts:9`）。

- [x] **Step 1: 写失败测试**

```ts
it('builds a deterministic report without diff or transcript', () => {
  const { report, canonical } = buildAcceptanceReport(fixture)
  expect(report.acceptance.counts).toEqual({ total: 3, pass: 2, fail: 1, pending: 0, waived: 0 })
  expect(report.usage.workerCostUsd).toBe(1.2)
  expect(report.usage.verifierCostUsd).toBe(0.08)
  expect(report.changes.files).toHaveLength(2)
  expect(JSON.stringify(report)).not.toContain('diff --git')
  expect(canonical).toBe(stableStringify(report))
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/core exec vitest run test/acceptance-report.test.ts`
Expected: FAIL。

- [x] **Step 3: 实现**

- 输入：`{ taskTitle, goal, review, contract, items, run, workerSessions, verifierSessions, budget, workspaceRoot }`。
- 输出按 spec §7.1；`result` 取 `run.summary` 或 `review.preliminaryReason`，没有写“未生成”。
- `changes.files` 最多 20，路径相对化；`verify.outputSummary` 截断 2k。
- `risks`：verify skipped、AC fail/pending、预算 near/over、worktree、run failed。
- `canonical = stableStringify(report)`；不含 hash。
- 不读 transcript；不调用 LLM。

- [x] **Step 4: 跑测试**

Run: `pnpm --filter @baton/core exec vitest run test/acceptance-report.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add packages/core/src/acceptance/report.ts packages/core/test/acceptance-report.test.ts
git commit -m "feat(core): 验收报告派生与规范 JSON"
```

---

### Task 5: Core 预算与自动批准上限

Blocking: Task 1
Slice type: tracer-bullet
Seam: 纯函数

**Files:**
- Create: `packages/core/src/budget/state.ts`, `packages/core/src/budget/raise.ts`, `packages/core/src/automation/approval-cap.ts`
- Test: `packages/core/test/budget-core.test.ts`, `packages/core/test/approval-cap.test.ts`

**Interfaces:**
- Produces: `budgetState({ budgetUsd, workerCostUsd, verifierCostUsd, turns })` → `TaskBudgetSummary`；`canRaiseBudget({ status, waitingReason, spentUsd, nextBudgetUsd, maxBudgetUsd })`；`autoApprovalCapReached({ count, cap })`。

- [x] **Step 1: 写失败测试**

```ts
it('marks near/over budget', () => {
  expect(budgetState({ budgetUsd: 2, workerCostUsd: 1.7, verifierCostUsd: 0.1, turns: 3 }))
    .toMatchObject({ nearBudget: true, overBudget: false, remainingUsd: 0.3 })
  expect(budgetState({ budgetUsd: 2, workerCostUsd: 2.1, verifierCostUsd: 0, turns: 3 }).overBudget).toBe(true)
})

it('only raises above spent', () => {
  expect(canRaiseBudget({ status: 'waiting_input', waitingReason: 'budget', spentUsd: 2, nextBudgetUsd: 1, maxBudgetUsd: 50 }))
    .toMatchObject({ ok: false, code: 'budget_below_spent' })
  expect(canRaiseBudget({ status: 'waiting_input', waitingReason: 'budget', spentUsd: 2, nextBudgetUsd: 3, maxBudgetUsd: 50 }).ok).toBe(true)
})

it('cap 0 disables auto approval', () => {
  expect(autoApprovalCapReached({ count: 0, cap: 0 })).toBe(true)
  expect(autoApprovalCapReached({ count: 10, cap: 10 })).toBe(true)
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/core exec vitest run test/budget-core.test.ts test/approval-cap.test.ts`
Expected: FAIL。

- [x] **Step 3: 实现**

- `budgetState` 的 `spentUsd` 只累计 worker；`verifierCostUsd` 单独返回；`nearBudget = ratio >= 0.8 && !over`。
- `canRaiseBudget` 只在 `waiting_input(budget)` 允许恢复；`nextBudgetUsd > spentUsd` 且 `<= maxBudgetUsd`。
- `autoApprovalCapReached`：`cap <= 0 || count >= cap`。

- [x] **Step 4: 跑测试**

Run: `pnpm --filter @baton/core exec vitest run test/budget-core.test.ts test/approval-cap.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add packages/core/src/budget packages/core/src/automation/approval-cap.ts packages/core/test/budget-core.test.ts packages/core/test/approval-cap.test.ts
git commit -m "feat(core): 预算状态与自动批准上限纯函数"
```

---

### Task 6: 状态机预算转移与注意力

Blocking: Task 2, Task 5
Slice type: tracer-bullet
Seam: transition 矩阵

**Files:**
- Modify: `packages/core/src/state-machine/transition.ts`, `types.ts`, `attention.ts`
- Test: `packages/core/test/transition-budget.test.ts`

**Interfaces:**
- Produces: `budget_exceeded`（running/queued → waiting_input(budget)，running 时 effects 含 `interruptSession`）；`budget_raise`（waiting_input(budget) → queued）；`start` 守卫 `budget_exhausted`；`attentionFor` 把 budget 映射为 needs_approval；`canAcceptUserInput('budget')=false`。

- [x] **Step 1: 写失败测试**

```ts
it('stops a running task at budget', () => {
  const out = applyTransition(task({ status: 'running' }), { type: 'budget_exceeded' }, ctx())
  expect(out).toMatchObject({ ok: true, status: 'waiting_input', waitingReason: 'budget' })
  expect(out.effects).toContainEqual({ type: 'interruptSession' })
})

it('raises budget back to queued', () => {
  const out = applyTransition(task({ status: 'waiting_input', waitingReason: 'budget' }), { type: 'budget_raise', budgetUsd: 3 }, ctx())
  expect(out).toMatchObject({ ok: true, status: 'queued' })
})

it('start refuses exhausted budget', () => {
  const out = applyTransition(task({ status: 'queued' }), { type: 'start' }, ctx({ budgetRemainingUsd: 0 }))
  expect(out).toMatchObject({ ok: false, code: 'budget_exhausted' })
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/core exec vitest run test/transition-budget.test.ts`
Expected: FAIL。

- [x] **Step 3: 实现**

- `types.ts` 的 `TransitionContext` 加 `budgetRemainingUsd?: number`。
- `transition.ts` 在 `start` 分支前检查 `(ctx.budgetRemainingUsd ?? Infinity) <= 0`，返回 `budget_exhausted`。
- 新增 `budget_exceeded` / `budget_raise` 分支；错误状态返回 `invalid_transition`。
- `attention.ts` 的 `attentionFor` 把 `'budget'` 归入 `needs_approval`；`canAcceptUserInput` 对 `'budget'` 返回 false。

- [x] **Step 4: 跑测试**

Run: `pnpm --filter @baton/core exec vitest run test/transition-budget.test.ts && pnpm --filter @baton/core test`
Expected: PASS；既有 transition 矩阵不回归。

- [x] **Step 5: Commit**

```bash
git add packages/core/src/state-machine packages/core/test/transition-budget.test.ts
git commit -m "feat(core): 预算耗尽/提额转移与注意力"
```

---

### Task 7: DB schema 与 migration 0012

Blocking: Task 1
Slice type: tracer-bullet
Seam: fixture DB 0011 → 0012

**Files:**
- Modify: `apps/daemon/src/db/schema.ts`
- Create: `apps/daemon/migrations/0012_m6_3_acceptance_evidence.sql`（由 drizzle-kit 生成）
- Modify: `apps/daemon/migrations/meta/_journal.json`, `0012_snapshot.json`
- Test: `apps/daemon/test/migration-0012.test.ts`

**Interfaces:**
- Produces: `acceptanceContract`, `acceptanceItem`, `acceptanceRun` tables；`task.budgetUsd`。

- [x] **Step 1: 写失败测试**

```ts
it('upgrades 0011 to 0012 and keeps old tasks readable', () => {
  // 复用 migration-0011.test.ts 的 copyMigrationsThrough0010 模式，参数化为 11
  const dir = copyMigrationsThrough(11)
  const raw = openDb(':memory:')
  process.env.BATON_MIGRATIONS_DIR = dir
  migrateDb(raw)
  raw.prepare("insert into task (id, workspace_id, title, prompt, status, engine, retry_count, dangerously_skip_permissions, created_at, updated_at) values ('t1','w1','t','p','todo','fake',0,0,1,1)").run()
  process.env.BATON_MIGRATIONS_DIR = migrationsDir
  migrateDb(raw)
  expect(raw.prepare("select budget_usd from task where id='t1'").get()).toEqual({ budget_usd: null })
  expect(raw.prepare("select name from sqlite_master where type='table' and name in ('acceptance_contract','acceptance_item','acceptance_run')").all()).toHaveLength(3)
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/migration-0012.test.ts`
Expected: FAIL，表/列不存在。

- [x] **Step 3: 改 schema**

在 `schema.ts` 增加三张表（字段按 spec §4.1-4.3）与 `budgetUsd: real('budget_usd')`；索引/唯一约束按 spec。`acceptance_run.review_id` 参照 `review.id`，`uniqueIndex('acceptance_run_review_idx').on(t.reviewId)`。

- [x] **Step 4: 生成 migration**

Run: `pnpm --dir apps/daemon exec drizzle-kit generate --name m6_3_acceptance_evidence`
Expected: 生成 `0012_m6_3_acceptance_evidence.sql` 与 meta；检查 SQL 只含 `CREATE TABLE` / `ALTER TABLE task ADD COLUMN budget_usd real`，无数据回填。

- [x] **Step 5: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/migration-0012.test.ts && pnpm --filter @evanfang0054/baton typecheck`
Expected: PASS。

- [x] **Step 6: Commit**

```bash
git add apps/daemon/src/db/schema.ts apps/daemon/migrations apps/daemon/test/migration-0012.test.ts
git commit -m "feat(daemon): migration 0012 验收三表与任务预算"
```

---

### Task 8: Fake verifier 脚本与 StartInput.maxBudgetUsd

Blocking: Task 1
Slice type: tracer-bullet
Seam: fake adapter 脚本选择 + Claude transport 参数

**Files:**
- Modify: `packages/protocol/src/adapter.ts`（`StartInput.maxBudgetUsd?: number`）
- Modify: `packages/adapters/src/fake.ts`, `packages/adapters/src/claude/adapter.ts`
- Test: `packages/adapters/test/fake.test.ts`, `packages/adapters/test/claude-budget.test.ts`

**Interfaces:**
- Produces: `FakeOptions.verifierScript?: FakeStep[]`；`VERIFIER_PROMPT_MARKER='<verifier_task>'`；`StartInput.maxBudgetUsd`；Claude adapter 使用 `input.maxBudgetUsd ?? options.maxBudgetUsd`。

- [x] **Step 1: 写失败测试**

```ts
it('uses verifierScript when prompt has marker', async () => {
  const adapter = new FakeAdapter({
    script: [{ kind: 'text', text: 'worker' }, { kind: 'finish' }],
    verifierScript: [{ kind: 'text', text: '<acceptance_report>{"verdict":"pass","summary":"ok","items":[]}</acceptance_report>' }, { kind: 'finish' }],
  })
  const run = await adapter.start(input({ prompt: '<verifier_task>检查</verifier_task>' }))
  const events = await collect(run)
  expect(events.some((e) => e.type === 'TEXT_MESSAGE_CONTENT' && String(e.delta).includes('acceptance_report'))).toBe(true)
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/adapters exec vitest run test/fake.test.ts`
Expected: FAIL。

- [x] **Step 3: 实现**

- `FakeOptions` 加 `verifierScript`；`start(input)` 选择 `input.prompt.includes(VERIFIER_PROMPT_MARKER) ? verifierScript : script`。
- `StartInput` 加 `maxBudgetUsd?: number`。
- `ClaudeAdapter.start` 把 `maxBudgetUsd: input.maxBudgetUsd ?? this.options.maxBudgetUsd` 传给 transport。
- 导出 `VERIFIER_PROMPT_MARKER` 供 daemon 用。

- [x] **Step 4: 跑测试与 typecheck**

Run: `pnpm --filter @baton/adapters test && pnpm --filter @baton/adapters typecheck`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add packages/protocol/src/adapter.ts packages/adapters/src packages/adapters/test
git commit -m "feat(adapters): fake verifier 脚本与按 run 预算"
```

---

## 自检

- [x] Spec §4-§9 的 schema/纯函数/状态机均有对应 task。
- [x] 没有新增任务状态；只新增 `waitingReason='budget'`。
- [x] `pnpm --filter @baton/protocol test`、`pnpm --filter @baton/core test`、`pnpm --filter @baton/adapters test`、`pnpm --filter @evanfang0054/baton exec vitest run test/migration-0012.test.ts` 全绿。
- [x] 不触碰 daemon 业务/web；留给 Plan 2-5。


## 执行记录

- 2026-11-21：Task 1-8 完成。
- 提交：`358aafe` protocol 实体、`ac351fc` protocol 命令/事件、`ce04d64` core AC、`0414d30` core 报告、`7188f9a` core 预算/上限、`42894b0` core 转移、`9e45636` daemon migration 0012、`1c7c0ab` adapters fake verifier/预算、`e01ac25` web fixture、`550a58a` 格式化。
- 验证：protocol 151、core 198、adapters 31、daemon 338 tests 全绿；`pnpm typecheck` 全绿；`pnpm verify` 退出码 0（typecheck + lint + format + boundaries + protocol + tests + build）。
- 偏差：`runtime/index.ts` 的 `task.set_budget` / `acceptance.update` 先返回 `unsupported_command` 兜底，Plan 2/3 替换为真实服务；迁移表数从 16 → 19，`migrate.test.ts` 已同步。
