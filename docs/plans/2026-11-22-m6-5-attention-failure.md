---
spec_ref: ../specs/2026-11-22-m6-5-supervisor-autonomy-design.md
spec_topic: m6-5-supervisor-autonomy
task_count: 6
estimated_phases: [tests, implementation, verification]
dod: "task_failure 写入与保留、get_task_failure/lastFailure、buildAttentionItems、digest 需要你决定、attentionReminder 三档、DigestCard 与最近失败卡；pnpm verify 全绿"
status: completed
depends_on: [2026-11-22-m6-5-governance.md]
---

# M6-5 Plan B：注意力与失败摘要

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `agent-harness:subagent-driven-development`（推荐）或 `agent-harness:executing-plans`，按 task 逐条执行。

**Goal:** 把“今天需要你决定的事”收敛成 digest 里的一张清单；daemon 在 worker/verifier/budget 失败时写脱敏的结构化摘要，总管和任务详情只读摘要，不读 transcript。

**Architecture:** 协议层加 `AttentionItem`/`FailureSummary`；core 提供纯函数 `buildAttentionItems` 与 `buildFailureSummary`；daemon 新增 failure service，在三条失败路径写入，并让 digest 批量读取；web 只在 DigestCard 与任务详情增加展示。Plan A 的 `supervisor_action` 为 failed 任务提供可应用的 retry proposal。

**Tech Stack:** TypeScript ESM、zod 4、Drizzle/better-sqlite3、React 19 + TanStack Query + HeroUI v3、vitest。

**Design sync:**
- DigestCard 的“需要你决定”分组沿用 `border-separator`、`bg-default`、`text-muted`、`text-warning`、`text-danger`；应用按钮用 `secondary` 或 `tertiary`，不新造强调色。
- 每条只显示标题、原因、等待时长、一个动作；无事项时整组不渲染，保持安静。
- 最近失败卡用 danger 语义，只展示 stage/summary/lastError/相对路径；移动端放进 `MobileCollapsible`。

**Contract mapping:**
- DoD 18：digest 只列需要人的任务，计数=列表长度；安全建议可应用，approve/reject/取消运行中只给跳转。
- DoD 20：`task_failure` 由 daemon 生成，保留 20 条/任务；总管只读摘要；不含 transcript/绝对路径。
- DoD 1/3：attentionReminder 三档与 observe/auto/kill switch 的组合。

**Commit strategy:** 每个 task 末尾一次 commit。

---

### Task B1: 协议加 AttentionItem 与 FailureSummary

Blocking: Plan A 完成
Slice type: tracer-bullet
Seam: `DigestReport.parse` / `TaskDetailResponse.parse`

**Files:**
- Create: `packages/protocol/src/attention.ts`
- Create: `packages/protocol/src/task-failure.ts`
- Modify: `packages/protocol/src/automation.ts`
- Modify: `packages/protocol/src/api.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/attention.test.ts`
- Test: `packages/protocol/test/task-failure.test.ts`
- Test: `packages/protocol/test/automation.test.ts`

**Interfaces:**
- Consumes: `Id`/`Timestamp`、`TaskStatus`、`Attention`。
- Produces: `AttentionKind`、`AttentionItem`、`DigestAttention`、`FailureStage`、`FailureSummary`、`TaskFailure`。

- [ ] **Step 1: Write failing tests**

```ts
// packages/protocol/test/attention.test.ts
import { describe, expect, it } from 'vitest'
import { AttentionItem, DigestAttention } from '../src/attention.js'

describe('attention schemas', () => {
  it('parses an apply_proposal item', () => {
    expect(
      AttentionItem.parse({
        taskId: 't1',
        title: '登录页修复',
        kind: 'failed',
        reason: '任务失败，建议重试',
        waitingSince: 10,
        proposalId: 'a1',
        action: { type: 'apply_proposal', proposalId: 'a1' },
      }),
    ).toMatchObject({ action: { type: 'apply_proposal' } })
  })

  it('defaults to an empty digest attention block', () => {
    expect(
      DigestAttention.parse({ items: [], counts: { approval: 0, reply: 0, review: 0, failed: 0, budget: 0, stale: 0 } }),
    ).toEqual({
      items: [],
      counts: { approval: 0, reply: 0, review: 0, failed: 0, budget: 0, stale: 0 },
    })
  })
})
```

```ts
// packages/protocol/test/task-failure.test.ts
import { describe, expect, it } from 'vitest'
import { FailureSummary, TaskDetailResponse } from '../src/index.js'

describe('failure summary', () => {
  it('accepts a sanitized summary', () => {
    expect(
      FailureSummary.parse({
        stage: 'verify',
        lastError: 'pnpm test failed at <workspace>/src/login.ts',
        retryable: true,
        affectedPaths: ['src/login.ts'],
        summary: '自动校验未通过',
        createdAt: 1,
      }),
    ).toMatchObject({ stage: 'verify' })
  })

  it('defaults lastFailure to null for old task detail payloads', () => {
    const parsed = TaskDetailResponse.parse({
      task: {
        id: 't1',
        workspaceId: 'w1',
        nodeId: 'a1',
        title: 't',
        prompt: 'p',
        status: 'todo',
        waitingReason: null,
        engine: 'fake',
        workspaceMode: 'main',
        branch: null,
        worktreePath: null,
        verifyCommand: null,
        retryCount: 0,
        dangerouslySkipPermissions: false,
        budgetUsd: null,
        enqueuedAt: null,
        createdAt: 1,
        updatedAt: 1,
        context: null,
        origin: null,
      },
      contextInvalid: false,
      originInvalid: false,
      sessions: [],
      approvals: [],
      review: null,
      waitingSince: null,
      attention: 'none',
      acceptance: null,
      budget: null,
    })
    expect(parsed.lastFailure).toBeNull()
  })
})
```

`automation.test.ts` 追加：旧 DigestReport 缺 `attention` 时解析出空数组与零计数。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @baton/protocol test -- attention task-failure automation`
Expected: FAIL because schemas do not exist.

- [ ] **Step 3: Implement schemas**

`packages/protocol/src/attention.ts`：

```ts
import { z } from 'zod'
import { Id, Timestamp } from './common.js'

export const AttentionKind = z.enum(['approval', 'reply', 'review', 'failed', 'budget', 'stale'])
export type AttentionKind = z.infer<typeof AttentionKind>

export const AttentionItem = z
  .object({
    taskId: Id,
    title: z.string().min(1),
    kind: AttentionKind,
    reason: z.string().min(1).max(200),
    waitingSince: Timestamp.nullable(),
    proposalId: Id.nullable(),
    action: z.discriminatedUnion('type', [
      z.object({ type: z.literal('open_task') }),
      z.object({ type: z.literal('open_review') }),
      z.object({ type: z.literal('apply_proposal'), proposalId: Id }),
    ]),
  })
  .strict()
export type AttentionItem = z.infer<typeof AttentionItem>

export const AttentionCounts = z
  .object({
    approval: z.number().int().nonnegative(),
    reply: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    budget: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
  })
  .strict()
export type AttentionCounts = z.infer<typeof AttentionCounts>

export const EMPTY_ATTENTION_COUNTS: AttentionCounts = {
  approval: 0,
  reply: 0,
  review: 0,
  failed: 0,
  budget: 0,
  stale: 0,
}

export const DigestAttention = z
  .object({
    items: z.array(AttentionItem).max(20),
    counts: AttentionCounts,
  })
  .strict()
export type DigestAttention = z.infer<typeof DigestAttention>
```

`packages/protocol/src/task-failure.ts`：

```ts
import { z } from 'zod'
import { Id, Timestamp } from './common.js'

export const FailureStage = z.enum([
  'launch',
  'run',
  'verify',
  'review',
  'verifier',
  'budget',
  'unknown',
])
export type FailureStage = z.infer<typeof FailureStage>

export const FailureSummary = z
  .object({
    stage: FailureStage,
    lastError: z.string().max(2000),
    retryable: z.boolean(),
    affectedPaths: z.array(z.string().max(500)).max(20),
    summary: z.string().max(2000),
    createdAt: Timestamp,
  })
  .strict()
export type FailureSummary = z.infer<typeof FailureSummary>

export const TaskFailure = FailureSummary.extend({
  id: Id,
  workspaceId: Id,
  taskId: Id,
  sessionId: Id.nullable(),
  attempt: z.number().int().nonnegative(),
}).strict()
export type TaskFailure = z.infer<typeof TaskFailure>
```

`packages/protocol/src/automation.ts`：

```ts
import { DigestAttention } from './attention.js'
// DigestReport 内：
attention: DigestAttention.default(() => ({
  items: [],
  counts: { approval: 0, reply: 0, review: 0, failed: 0, budget: 0, stale: 0 },
})),
```

`packages/protocol/src/api.ts` 的 `TaskDetailResponse` 末行加：

```ts
lastFailure: FailureSummary.nullable().default(null),
```

`packages/protocol/src/index.ts` 增加 `export * from './attention.js'`、`export * from './task-failure.js'`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @baton/protocol test`
Expected: PASS；旧 digest notice 与旧 TaskDetail fixture 都兼容。

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src packages/protocol/test
git commit -m "feat(protocol): 增加注意力与失败摘要协议"
```

---

### Task B2: core 注意力合并与失败脱敏

Blocking: Task B1
Slice type: tracer-bullet
Seam: 纯函数单测

**Files:**
- Create: `packages/core/src/supervisor/attention.ts`
- Create: `packages/core/src/failures.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/supervisor-attention.test.ts`
- Test: `packages/core/test/failure-summary.test.ts`

**Interfaces:**
- Consumes: B1 `AttentionItem`/`AttentionCounts`/`FailureSummary`。
- Produces: `buildAttentionItems(input)`、`buildFailureSummary(input)`、`normalizeAffectedPaths(paths)`。

- [ ] **Step 1: Write failing tests**

```ts
// packages/core/test/supervisor-attention.test.ts
import { describe, expect, it } from 'vitest'
import { buildAttentionItems } from '../src/supervisor/attention.js'

const now = 10_000_000

describe('buildAttentionItems', () => {
  it('keeps one item per task by highest priority and counts exactly the list', () => {
    const result = buildAttentionItems({
      now,
      tasks: [
        {
          taskId: 't1',
          title: '待审批',
          status: 'waiting_input',
          attention: 'needs_approval',
          waitingReason: 'approval',
          waitingSince: now - 60_000,
          updatedAt: now - 60_000,
          acceptance: null,
          budget: null,
          proposalId: null,
          lastFailure: null,
        },
        {
          taskId: 't1',
          title: '待审批',
          status: 'waiting_input',
          attention: 'needs_approval',
          waitingReason: 'approval',
          waitingSince: now - 60_000,
          updatedAt: now - 60_000,
          acceptance: null,
          budget: { overBudget: true },
          proposalId: null,
          lastFailure: null,
        },
        {
          taskId: 't2',
          title: '失败',
          status: 'failed',
          attention: 'none',
          waitingReason: null,
          waitingSince: null,
          updatedAt: now - 10_000,
          acceptance: null,
          budget: null,
          proposalId: 'a2',
          lastFailure: { stage: 'run', summary: '进程退出 1' },
        },
      ],
    })
    expect(result.items.map((item) => [item.taskId, item.kind])).toEqual([
      ['t1', 'approval'],
      ['t2', 'failed'],
    ])
    expect(result.items[1]?.action).toEqual({ type: 'apply_proposal', proposalId: 'a2' })
    expect(result.counts.approval).toBe(1)
    expect(result.counts.failed).toBe(1)
    expect(Object.values(result.counts).reduce((sum, value) => sum + value, 0)).toBe(result.items.length)
  })

  it('uses open_review for review and open_task for approve/cancel', () => {
    const result = buildAttentionItems({
      now,
      tasks: [
        {
          taskId: 't1',
          title: '待验收',
          status: 'review',
          attention: 'needs_review',
          waitingReason: null,
          waitingSince: now - 1,
          updatedAt: now - 1,
          acceptance: null,
          budget: null,
          proposalId: null,
          lastFailure: null,
        },
      ],
    })
    expect(result.items[0]?.action).toEqual({ type: 'open_review' })
  })

  it('marks stale only below higher-priority reasons', () => {
    const result = buildAttentionItems({
      now,
      tasks: [
        {
          taskId: 't1',
          title: '陈旧',
          status: 'waiting_input',
          attention: 'none',
          waitingReason: 'question',
          waitingSince: now - 31 * 60_000,
          updatedAt: now - 31 * 60_000,
          acceptance: null,
          budget: null,
          proposalId: null,
          lastFailure: null,
        },
      ],
    })
    expect(result.items[0]?.kind).toBe('reply')
  })
})
```

```ts
// packages/core/test/failure-summary.test.ts
import { describe, expect, it } from 'vitest'
import { buildFailureSummary, normalizeAffectedPaths } from '../src/failures.js'

describe('failure summary', () => {
  it('redacts workspace roots, tokens and absolute paths', () => {
    const summary = buildFailureSummary({
      stage: 'run',
      message: 'token=abc123 failed at /Users/<user>/demo/src/login.ts',
      workspaceRoot: '/Users/<user>/demo',
      retryable: true,
      affectedPaths: ['/Users/<user>/demo/src/login.ts', 'src/login.ts', '../secret', 'src/a.ts'],
      now: 1,
    })
    expect(summary.lastError).toContain('<workspace>/src/login.ts')
    expect(summary.lastError).not.toContain('abc123')
    expect(summary.affectedPaths).toEqual(['src/login.ts', 'src/a.ts'])
  })

  it('truncates to 2k and keeps at most 20 paths', () => {
    const summary = buildFailureSummary({
      stage: 'verify',
      message: 'x'.repeat(3000),
      retryable: false,
      affectedPaths: Array.from({ length: 30 }, (_, index) => `src/${index}.ts`),
      now: 1,
    })
    expect(summary.lastError.length).toBe(2000)
    expect(summary.affectedPaths).toHaveLength(20)
    expect(normalizeAffectedPaths(['src/a.ts', '../x', '/tmp/y'])).toEqual(['src/a.ts'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @baton/core test -- supervisor-attention failure-summary`
Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement core functions**

`packages/core/src/supervisor/attention.ts`：

```ts
import type { AttentionCounts, AttentionItem, AttentionKind, FailureSummary } from '@baton/protocol'

export interface AttentionCandidate {
  taskId: string
  title: string
  status: 'todo' | 'queued' | 'running' | 'waiting_input' | 'verifying' | 'review' | 'done' | 'failed' | 'cancelled'
  attention: 'none' | 'needs_approval' | 'needs_reply' | 'needs_attention' | 'needs_review'
  waitingReason: 'approval' | 'question' | 'stalled' | 'dropped' | 'budget' | null
  waitingSince: number | null
  updatedAt: number
  acceptance: { counts: { fail: number } } | null
  budget: { overBudget: boolean } | null
  proposalId: string | null
  lastFailure: Pick<FailureSummary, 'stage' | 'summary'> | null
}

const PRIORITY: Record<AttentionKind, number> = {
  approval: 6,
  reply: 5,
  review: 4,
  failed: 3,
  budget: 2,
  stale: 1,
}

function kindFor(task: AttentionCandidate, now: number): AttentionKind | null {
  if (task.attention === 'needs_approval' || task.waitingReason === 'approval') return 'approval'
  if (
    task.attention === 'needs_reply' ||
    task.waitingReason === 'question' ||
    task.waitingReason === 'stalled' ||
    task.waitingReason === 'dropped'
  ) {
    return 'reply'
  }
  if (task.status === 'review' || task.attention === 'needs_review') return 'review'
  if (task.status === 'failed' || (task.acceptance?.counts.fail ?? 0) > 0) return 'failed'
  if (task.budget?.overBudget || task.waitingReason === 'budget') return 'budget'
  if (task.waitingSince !== null && task.waitingSince <= now - 30 * 60_000) return 'stale'
  return null
}

function reasonFor(kind: AttentionKind, task: AttentionCandidate): string {
  if (kind === 'approval') return '等待你审批'
  if (kind === 'reply') return '等待你回复'
  if (kind === 'review') return '等待你验收'
  if (kind === 'budget') return '超出预算，等你决定'
  if (kind === 'stale') return '已等待超过 30 分钟'
  return task.lastFailure?.summary || '执行失败，等你决定'
}

function actionFor(kind: AttentionKind, task: AttentionCandidate): AttentionItem['action'] {
  if (kind === 'review') return { type: 'open_review' }
  if (kind === 'failed' && task.proposalId) {
    return { type: 'apply_proposal', proposalId: task.proposalId }
  }
  return { type: 'open_task' }
}

export function buildAttentionItems(input: {
  tasks: AttentionCandidate[]
  now: number
  limit?: number
}): { items: AttentionItem[]; counts: AttentionCounts } {
  const byTask = new Map<string, { kind: AttentionKind; task: AttentionCandidate }>()
  for (const task of input.tasks) {
    const kind = kindFor(task, input.now)
    if (!kind) continue
    const previous = byTask.get(task.taskId)
    if (!previous || PRIORITY[kind] > PRIORITY[previous.kind]) {
      byTask.set(task.taskId, { kind, task })
    }
  }
  const items = [...byTask.values()]
    .sort((a, b) => {
      const rank = PRIORITY[b.kind] - PRIORITY[a.kind]
      if (rank !== 0) return rank
      const waiting = (a.task.waitingSince ?? Number.POSITIVE_INFINITY) - (b.task.waitingSince ?? Number.POSITIVE_INFINITY)
      if (waiting !== 0) return waiting
      return b.task.updatedAt - a.task.updatedAt
    })
    .slice(0, input.limit ?? 20)
    .map(({ kind, task }) => ({
      taskId: task.taskId,
      title: task.title,
      kind,
      reason: reasonFor(kind, task),
      waitingSince: task.waitingSince,
      proposalId: kind === 'failed' ? task.proposalId : null,
      action: actionFor(kind, task),
    }))
  const counts: AttentionCounts = { approval: 0, reply: 0, review: 0, failed: 0, budget: 0, stale: 0 }
  for (const item of items) counts[item.kind] += 1
  return { items, counts }
}
```

`packages/core/src/failures.ts`：

```ts
import type { FailureStage, FailureSummary } from '@baton/protocol'

export function normalizeAffectedPaths(paths: string[]): string[] {
  return paths
    .map((path) => path.replaceAll('\\', '/').trim())
    .filter((path) => path.length > 0 && !path.startsWith('/') && !path.startsWith('..'))
    .slice(0, 20)
    .map((path) => path.slice(0, 500))
}

export function sanitizeFailureText(input: {
  text: string
  workspaceRoot?: string
  max?: number
}): string {
  let text = input.text
  if (input.workspaceRoot) {
    text = text.split(input.workspaceRoot).join('<workspace>')
  }
  text = text.replace(/\/(?:Users|home)\/[^/\s]+\//g, '<workspace>/')
  text = text.replace(/\b(token|apiKey|secret|authorization)\s*[:=]\s*\S+/gi, '$1=<redacted>')
  const max = input.max ?? 2000
  return text.length > max ? text.slice(0, max) : text
}

export function buildFailureSummary(input: {
  stage: FailureStage
  message: string
  retryable: boolean
  affectedPaths?: string[]
  summary?: string
  workspaceRoot?: string
  now: number
}): FailureSummary {
  return {
    stage: input.stage,
    lastError: sanitizeFailureText({
      text: input.message,
      ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    }),
    retryable: input.retryable,
    affectedPaths: normalizeAffectedPaths(input.affectedPaths ?? []),
    summary: sanitizeFailureText({
      text: input.summary ?? input.message,
      ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    }),
    createdAt: input.now,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @baton/core test -- supervisor-attention failure-summary
pnpm --filter @baton/core test
```

Expected: PASS；counts 总和等于 items 长度。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/supervisor/attention.ts packages/core/src/failures.ts packages/core/src/index.ts packages/core/test
git commit -m "feat(core): 增加注意力合并与失败脱敏"
```

---

### Task B3: daemon 写 task_failure、get_task_failure 与 lastFailure

Blocking: Task B2
Slice type: tracer-bullet
Seam: `createFailureService` + runtime failure paths

**Files:**
- Create: `apps/daemon/src/failures/service.ts`
- Modify: `apps/daemon/src/runtime/index.ts`
- Modify: `apps/daemon/src/runtime/session-runner.ts`
- Modify: `apps/daemon/src/verify/runner.ts`
- Modify: `apps/daemon/src/supervisor/service.ts`
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Modify: `apps/daemon/src/supervisor/engine.ts`
- Modify: `apps/daemon/src/supervisor/prompt.ts`
- Modify: `apps/daemon/src/http/tasks.ts`
- Modify: `apps/daemon/src/app.ts`
- Modify: `packages/core/src/supervisor/policy.ts`
- Test: `apps/daemon/test/task-failure.test.ts`
- Test: `apps/daemon/test/failure-paths.test.ts`
- Test: `apps/daemon/test/supervisor-engine-mock.test.ts`
- Test: `apps/daemon/test/supervisor-tools.test.ts`

**Interfaces:**
- Consumes: B2 `buildFailureSummary`；A2 `task_failure` table。
- Produces: `createFailureService(deps)`、`get_task_failure` 工具（第 18 个）、`TaskDetail.lastFailure`。

- [ ] **Step 1: Write failing tests**

```ts
// apps/daemon/test/task-failure.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { createFailureService } from '../src/failures/service.js'
import { createTestDb, seedTask, type TestDb } from './helpers/db.js'

const dbs: TestDb[] = []
afterEach(() => dbs.splice(0).forEach((entry) => entry.raw.close()))

describe('failure service', () => {
  it('redacts and keeps only the latest 20 rows per task', () => {
    const database = createTestDb()
    dbs.push(database)
    const seeded = seedTask(database.raw, { taskStatus: 'failed' })
    let now = 1
    const service = createFailureService({
      db: database.db,
      now: () => now++,
      newId: (() => {
        let index = 0
        return () => `f-${++index}`
      })(),
      workspaceRoot: () => '<workspace>',
    })
    for (let index = 0; index < 25; index += 1) {
      service.record({
        workspaceId: seeded.workspaceId,
        taskId: seeded.taskId,
        sessionId: seeded.sessionId,
        attempt: index,
        stage: 'run',
        message: `token=secret failed at <workspace>/src/${index}.ts`,
        retryable: true,
        affectedPaths: [`src/${index}.ts`, '/abs/secret.ts'],
      })
    }
    const rows = service.list(seeded.taskId, 20)
    expect(rows).toHaveLength(20)
    expect(rows[0]?.lastError).not.toContain('secret')
    expect(rows[0]?.affectedPaths).toEqual(['src/24.ts'])
    expect(service.latest(seeded.taskId)?.stage).toBe('run')
  })
})
```

`failure-paths.test.ts` 追加：

```ts
it('records a worker failure summary without transcript', async () => {
  const created = await createWsTestApp({
    useSessionRunner: true,
    useVerifyRunner: true,
    adapters: createAdapterFactory({
      fake: new FakeAdapter({ script: [{ kind: 'error', message: 'boom token=abc' }] }),
    }),
  })
  apps.push(created)
  clients.push(created.ws)
  const { handle, ws } = created
  ws.send({
    v: 1,
    type: 'task.create',
    id: 'f1',
    ts: 1,
    payload: createTaskPayload(handle, 'node -e "process.exit(0)"'),
  })
  const createdAck = await ws.next('ack')
  const taskId = (createdAck.payload as { data: { taskId: string } }).data.taskId
  ws.send({ v: 1, type: 'task.enqueue', id: 'f2', ts: 1, payload: { taskId } })
  await ws.next('ack')
  await waitFor(() => handle.runtime.getTask(taskId)?.status === 'failed', 10_000)
  const failure = handle.runtime.failures.latest(taskId)
  expect(failure?.stage).toBe('run')
  expect(failure?.lastError).not.toContain('abc')
})
```

`supervisor-engine-mock.test.ts` 的 `tools()` 增加 `get_task_failure: noop`，断言工具数从 17 变 18，列表加 `get_task_failure`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @evanfang0054/baton test -- task-failure failure-paths supervisor-engine-mock`
Expected: FAIL because failure service/tool do not exist.

- [ ] **Step 3: Implement failure service and wiring**

`apps/daemon/src/failures/service.ts`：

```ts
import { buildFailureSummary } from '@baton/core'
import type { FailureStage, FailureSummary, TaskFailure } from '@baton/protocol'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { taskFailure } from '../db/schema.js'
import type { Db } from '../db/types.js'

export interface FailureServiceDeps {
  db: Db
  now: () => number
  newId: () => string
  workspaceRoot: (workspaceId: string) => string | null
}

export function createFailureService(deps: FailureServiceDeps) {
  function record(input: {
    workspaceId: string
    taskId: string
    sessionId: string | null
    attempt: number
    stage: FailureStage
    message: string
    retryable: boolean
    affectedPaths?: string[]
  }): FailureSummary {
    const now = deps.now()
    const workspaceRoot = deps.workspaceRoot(input.workspaceId)
    const summary = buildFailureSummary({
      stage: input.stage,
      message: input.message,
      retryable: input.retryable,
      affectedPaths: input.affectedPaths ?? [],
      ...(workspaceRoot ? { workspaceRoot } : {}),
      now,
    })
    const id = deps.newId()
    deps.db.transaction((tx) => {
      tx.insert(taskFailure)
        .values({
          id,
          workspaceId: input.workspaceId,
          taskId: input.taskId,
          sessionId: input.sessionId,
          attempt: input.attempt,
          stage: summary.stage,
          lastError: summary.lastError,
          retryable: summary.retryable,
          affectedPathsJson: JSON.stringify(summary.affectedPaths),
          summary: summary.summary,
          createdAt: summary.createdAt,
        })
        .run()
      tx.run(sql`
        delete from task_failure
        where task_id = ${input.taskId}
          and id not in (
            select id from task_failure
            where task_id = ${input.taskId}
            order by created_at desc, rowid desc
            limit 20
          )
      `)
    })
    return summary
  }

  function list(taskId: string, limit = 3): TaskFailure[] {
    return deps.db
      .select()
      .from(taskFailure)
      .where(eq(taskFailure.taskId, taskId))
      .orderBy(desc(taskFailure.createdAt))
      .limit(Math.min(limit, 20))
      .all()
      .map((row) =>
        TaskFailure.parse({
          id: row.id,
          workspaceId: row.workspaceId,
          taskId: row.taskId,
          sessionId: row.sessionId,
          attempt: row.attempt,
          stage: row.stage,
          lastError: row.lastError,
          retryable: row.retryable,
          affectedPaths: row.affectedPathsJson ? JSON.parse(row.affectedPathsJson) : [],
          summary: row.summary,
          createdAt: row.createdAt,
        }),
      )
  }

  function latest(taskId: string): FailureSummary | null {
    return list(taskId, 1)[0] ?? null
  }

  function latestByTaskIds(taskIds: string[]): Map<string, FailureSummary> {
    if (taskIds.length === 0) return new Map()
    const rows = deps.db
      .select()
      .from(taskFailure)
      .where(inArray(taskFailure.taskId, taskIds))
      .orderBy(desc(taskFailure.createdAt))
      .all()
    const result = new Map<string, FailureSummary>()
    for (const row of rows) {
      if (!result.has(row.taskId)) {
        result.set(row.taskId, {
          stage: row.stage as FailureStage,
          lastError: row.lastError,
          retryable: row.retryable,
          affectedPaths: row.affectedPathsJson ? JSON.parse(row.affectedPathsJson) : [],
          summary: row.summary,
          createdAt: row.createdAt,
        })
      }
    }
    return result
  }

  return { record, list, latest, latestByTaskIds }
}
```

导入 `sql` from `drizzle-orm`。`deps.workspaceRoot` 用 `getWorkspace` + `resolveWorkspaceDir` 的 helper；不要在 service 里读文件。

runtime wiring：

```ts
const failures = createFailureService({
  db: deps.db,
  now,
  newId,
  workspaceRoot: (workspaceId) => {
    const workspace = getWorkspace(deps.db, workspaceId)
    return workspace ? resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath) : null
  },
})
```

把 `failures` 传入 `createSupervisorService`、`createSessionRunner`、`createVerifyRunner`，并返回 `failures`。

失败路径：

- `apps/daemon/src/runtime/session-runner.ts`：在 `handleRunError` / `applyTransition({type:'error'})` 前调用 `deps.failures.record({ stage: 'run', message, retryable: true, sessionId, attempt: task.retryCount })`；worktree/start 失败 stage `launch`；`budget_exceeded` stage `budget`、`retryable:false`。
- `apps/daemon/src/verify/runner.ts`：`result.exitCode !== 0 && result.exitCode !== VERIFY_SKIPPED` 时，在 `applyTransition({type:'verify_fail'})` 前调用 `failures.record({ stage:'verify', message: result.output, retryable:true, affectedPaths: diff?.files.map((file)=>file.path) ?? [] })`；`VERIFY_SKIPPED` 记录 `retryable:false`，但不把跳过当成失败阻断。
- `apps/daemon/src/supervisor/service.ts`：`failAcceptanceRun` 写 `stage:'review'`；验收员任务 `input.status === 'failed'` 写 `stage:'verifier'`，sessionId 取 `listSessionsByTask(task.id).at(-1)?.id`。

`get_task_failure` 工具：

```ts
const getTaskFailureInput = z.object({
  taskId: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(3),
})
```

execute 先 `resolveTaskId` 再用 `deps.failures.list(taskId, parsed.limit)`，返回 `{ taskId, failures }`。同时 `get_task` 返回对象加 `lastFailure: deps.failures.latest(task.id)`。工具数 17→18：`SupervisorToolset`、`BoundToolset`、`bindTools`、`engine.ts`、`service.ts` 的 `wrapped` 各加一项；`SUPERVISOR_POLICY.allowedTools` 加 `get_task_failure`；prompt 第 2 条改为“18 个工具”并加一行说明“失败摘要只读，不读 transcript”。

`http/tasks.ts` 的 `TaskDetailResponse.parse` 加 `lastFailure: deps.failures.latest(task.id)`；`TaskRoutesDeps` 增加 `failures`，`app.ts` 传入。

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @evanfang0054/baton test -- task-failure failure-paths supervisor-engine-mock supervisor-tools
pnpm --filter @evanfang0054/baton typecheck
```

Expected: PASS；工具接线断言 18 个；失败摘要不含 `token=abc`。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src packages/core/src/supervisor/policy.ts apps/daemon/test
git commit -m "feat(daemon): 写入脱敏失败摘要"
```

---

### Task B4: digest attention 与 attentionReminder

Blocking: Task B3
Slice type: tracer-bullet
Seam: `digest.generate` + `observeTask`

**Files:**
- Modify: `apps/daemon/src/automation/digest.ts`
- Modify: `apps/daemon/src/supervisor/service.ts`
- Modify: `apps/daemon/src/runtime/index.ts`
- Modify: `apps/daemon/src/automation/scheduler.ts`（仅 trigger 类型/调用点，如需要）
- Modify: `apps/daemon/src/budget/service.ts`（批量预算摘要）
- Modify: `apps/daemon/src/db/repositories.ts`（`listSessionsByTasks` 一次 `inArray` 查询）
- Test: `apps/daemon/test/automation-digest.test.ts`
- Test: `apps/daemon/test/supervisor-observe.test.ts`

**Interfaces:**
- Consumes: B2 `buildAttentionItems`；B3 `failures.latestByTaskIds`；A4 `actions.listProposed`/`propose`/`decide`。
- Produces: `DigestReport.attention`；`attentionReminder` 三档行为。

- [ ] **Step 1: Write failing tests**

```ts
// apps/daemon/test/automation-digest.test.ts（追加）
it('adds one attention item per task and counts equal the list length', () => {
  const database = createTestDb()
  dbs.push(database)
  const seeded = seedTask(database.raw, { taskStatus: 'waiting_input' })
  database.raw
    .prepare("update task set waiting_reason='approval', updated_at=10 where id=?")
    .run(seeded.taskId)
  const service = createDigestService({
    db: database.db,
    config,
    eventStore,
    broadcast: () => {},
    now: () => 100,
    newId: (() => {
      let index = 0
      return () => `id-${++index}`
    })(),
    actions: {
      listProposed: () => [],
      propose: () => ({ ok: false as const, error: appError('unused', 'unused') }),
      decide: () => ({ ok: false as const, error: appError('unused', 'unused') }),
      expire: () => 0,
      cleanup: () => 0,
    } as never,
    failures: { latestByTaskIds: () => new Map() } as never,
  })
  const notice = service.generate(seeded.workspaceId, 'manual')
  const report = DigestReport.parse(notice?.payload)
  expect(report.attention.items.map((item) => item.kind)).toEqual(['approval'])
  expect(report.attention.counts.approval).toBe(1)
  expect(Object.values(report.attention.counts).reduce((sum, value) => sum + value, 0)).toBe(
    report.attention.items.length,
  )
})
```

```ts
// apps/daemon/test/supervisor-observe.test.ts（追加）
it('writes a retry proposal in observe, applies in auto, and stays quiet when off', async () => {
  const observe = setup(engine, { trusted: true })
  observe.setAutonomy({ mode: 'observe', autoRetry: 'observe' })
  observe.service.observeTask({ taskId: observe.seeded.taskId, status: 'failed', waitingReason: null })
  expect(observe.transitions).toEqual([])
  expect(observe.actions.listProposed(observe.seeded.workspaceId)).toHaveLength(1)

  const auto = setup(engine, { trusted: true })
  auto.setAutonomy({ mode: 'auto', autoRetry: 'auto' })
  auto.service.observeTask({ taskId: auto.seeded.taskId, status: 'failed', waitingReason: null })
  await auto.drain()
  expect(auto.transitions).toHaveLength(1)
  expect(auto.transitions[0]?.event.type).toBe('retry')

  const off = setup(engine, { trusted: true })
  off.setAutonomy({ mode: 'observe', autoRetry: 'off' })
  off.service.observeTask({ taskId: off.seeded.taskId, status: 'failed', waitingReason: null })
  expect(off.actions.listProposed(off.seeded.workspaceId)).toHaveLength(0)
})
```

`supervisor-observe.test.ts` 的 `setup` 按下面三处扩展，保证 `observeTask` 能看到 supervisor-chat origin 与真实 policy：

```ts
// setup 内，在 createSupervisorService 之前：
const actions = createSupervisorActionService({
  db: database.db,
  now: () => 10,
  newId: () => `action-${++sequence}`,
  policyVersion: () => 'policy-1',
  requireMandate: () => null,
  applyTransition: (taskId, event) => {
    transitions.push({ taskId, event })
    return {
      ok: true,
      taskId,
      status: 'queued',
      previousStatus: 'failed',
      retryCount: 1,
      waitingReason: null,
      events: [],
    }
  },
  enqueueTask: () => ({ ok: true, status: 'queued' }),
  generateDigest: () => null,
})
database.raw
  .prepare('update task set origin_json = ? where id = ?')
  .run(
    JSON.stringify(
      buildTaskOrigin({
        source: 'supervisor-chat',
        triggerId: 'trigger-1',
        threadId: 'thread-1',
        workspaceId: seeded.workspaceId,
        targetNodeId: seeded.nodeId,
        contextNodeIds: [],
        policyVersion: 'policy-1',
        promptVersion: 'prompt-1',
        createdAt: 1,
      }),
    ),
    seeded.taskId,
  )
const setAutonomy = (autonomy: {
  mode: 'off' | 'observe' | 'auto'
  autoRetry: 'off' | 'observe' | 'auto'
}) => {
  mkdirSync(join(root, seeded.relPath, '.baton'), { recursive: true })
  writeFileSync(
    join(root, seeded.relPath, '.baton', 'policy.json'),
    JSON.stringify({ autonomy: { ...autonomy, attentionReminder: 'observe' } }),
  )
}
// createSupervisorService 的 deps 增加：
actions,
loadPolicy: (workspaceId) => loadWorkspacePolicy(database.db, config, workspaceId),
// setup 返回：
return { database, seeded, service, frames, transitions, root, actions, setAutonomy, drain }
```

顶部补 `mkdirSync`、`writeFileSync`、`join` 与 `buildTaskOrigin`、`createSupervisorActionService`、`loadWorkspacePolicy` 的 import。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @evanfang0054/baton test -- automation-digest supervisor-observe`
Expected: FAIL because attention is missing and observe never proposes.

- [ ] **Step 3: Implement digest attention and reminder**

`apps/daemon/src/automation/digest.ts`：

```ts
export type DigestTrigger = 'manual' | 'schedule' | 'attention'
export interface DigestServiceDeps {
  // ...existing...
  actions: ReturnType<typeof createSupervisorActionService>
  failures: ReturnType<typeof createFailureService>
}

const proposals = deps.actions.listProposed(workspaceId)
const proposalByTask = new Map(
  proposals.filter((action) => action.taskId).map((action) => [action.taskId!, action.id]),
)
const failures = deps.failures.latestByTaskIds(tasks.map((task) => task.id))
const acceptance = listAcceptanceSummaries(deps.db, tasks.map((task) => task.id))
const attention = buildAttentionItems({
  now,
  tasks: tasks.map((task) => ({
    taskId: task.id,
    title: task.title,
    status: task.status,
    attention: attentionFor(task.status, task.waitingReason),
    waitingReason: task.waitingReason,
    waitingSince: waitingSinceFor(task),
    updatedAt: task.updatedAt,
    acceptance: acceptance.get(task.id) ?? null,
    budget: getTaskBudgetSummary(deps.db, task, deps.config),
    proposalId: proposalByTask.get(task.id) ?? null,
    lastFailure: failures.get(task.id) ?? null,
  })),
})
const budgets = listTaskBudgetSummaries(deps.db, tasks, deps.config)
const report = DigestReport.parse({ ...buildDigest({ ... }), attention })
```

`apps/daemon/src/db/repositories.ts` 增加一次查询：

```ts
export function listSessionsByTasks(db: Db, taskIds: string[]): Session[] {
  if (taskIds.length === 0) return []
  return db
    .select()
    .from(session)
    .where(inArray(session.taskId, taskIds))
    .all()
    .map(toSession)
}
```

`apps/daemon/src/budget/service.ts` 增加：

```ts
export function listTaskBudgetSummaries(
  db: Db,
  tasks: Task[],
  config: Pick<Config, 'claudeMaxBudgetUsd'>,
): Map<string, TaskBudgetSummary> {
  const sessions = listSessionsByTasks(db, tasks.map((task) => task.id))
  const byTask = new Map<string, Session[]>()
  for (const item of sessions) {
    byTask.set(item.taskId, [...(byTask.get(item.taskId) ?? []), item])
  }
  return new Map(
    tasks.map((task) => [
      task.id,
      getTaskBudgetSummaryFromSessions(task, byTask.get(task.id) ?? [], config),
    ]),
  )
}
```

`getTaskBudgetSummary` 抽出 `getTaskBudgetSummaryFromSessions(task, sessions, config)`，原函数改为查一次 `listSessionsByTask` 后调用它，保证两条路径同一口径。Digest 用批量版本，避免 per-task N+1。

`generate` 新增窗口控制：

```ts
function generate(workspaceId: string, trigger: DigestTrigger, options: { advanceWindow?: boolean } = {}) {
  deps.actions.expire()
  deps.actions.cleanup()
  // ...
  const advanceWindow = options.advanceWindow ?? trigger !== 'attention'
  // transaction 内：
  if (advanceWindow) setSetting(tx, lastDigestKey(workspaceId), { at: now }, now)
}
```

attention trigger 默认不推进 `digest:last` 窗口，避免抢走下一次定时 digest 的变化计数；无需调用方额外传参。

`apps/daemon/src/supervisor/service.ts` 的 deps 增加：

```ts
remindAttention?: (input: {
  workspaceId: string
  taskId: string
  kind: 'review' | 'failed'
  reason: string
}) => void
```

在 `observeTask` 的 review 与 failed 分支末尾调用 `deps.remindAttention?.({ workspaceId: task.workspaceId, taskId: task.id, kind: 'failed', reason: ... })`。

`apps/daemon/src/runtime/index.ts`：

```ts
function remindAttention(input: { workspaceId: string; taskId: string; kind: 'review' | 'failed'; reason: string }) {
  const info = loadWorkspacePolicy(deps.db, deps.config, input.workspaceId)
  if (!info) return
  const mode = info.attentionReminder(automationState.isKillSwitchOn())
  if (mode !== 'auto') return
  const day = Math.floor(now() / 86_400_000)
  const proposed = actions.propose({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    kind: 'attention_reminder',
    strength: 'inferred',
    mode: 'auto',
    reason: input.reason,
    payload: { taskId: input.taskId, attentionKind: input.kind },
    policyVersion: info.policyVersion,
    dedupeKey: `attention:${input.taskId}:${input.kind}:${day}`,
  })
  if (proposed.ok) {
    actions.decide({
      workspaceId: input.workspaceId,
      actionId: proposed.action.id,
      actor: 'system',
      decision: 'apply',
    })
  }
}
```

`apps/daemon/src/supervisor/actions.ts` 增加 `generateDigest` 依赖，并恢复 `attention_reminder` 分支：

```ts
generateDigest?: (workspaceId: string, trigger: 'attention') => unknown | null

// applyAction 内：
if (action.kind === 'attention_reminder') {
  deps.generateDigest?.(action.workspaceId, 'attention')
  return { ok: true, result: { generated: true } }
}
```

运行时创建 action service 时传入：

```ts
generateDigest: (workspaceId) => digest.generate(workspaceId, 'attention'),
```

`createSupervisorService` 传入 `remindAttention`。`attentionReminder=observe` 不立即生成；下一次 digest 仍会包含 attention items。`off` 也不主动生成，但手动/定时 digest 仍显示当前需要人的任务。

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @evanfang0054/baton test -- automation-digest supervisor-observe
pnpm --filter @evanfang0054/baton test
```

Expected: PASS；observe/off 不调用 transition，auto 只调用一次。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/automation/digest.ts apps/daemon/src/supervisor/service.ts apps/daemon/src/runtime/index.ts apps/daemon/test
git commit -m "feat(daemon): 收敛 digest 注意力"
```

---

### Task B5: Web DigestCard 注意力分组与最近失败卡

Blocking: Task B4
Slice type: tracer-bullet
Seam: component tests

**Files:**
- Modify: `apps/web/src/features/supervisor/DigestCard.tsx`
- Modify: `apps/web/src/features/supervisor/SupervisorPanel.tsx`
- Modify: `apps/web/src/features/supervisor/DigestCard.test.tsx`
- Create: `apps/web/src/features/tasks/TaskFailureCard.tsx`
- Create: `apps/web/src/features/tasks/TaskFailureCard.test.tsx`
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.tsx`
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.test.tsx`
- Modify: `apps/web/src/lib/query.ts`（如需要 action query key）

**Interfaces:**
- Consumes: B1 `DigestReport.attention`；B3 `TaskDetail.lastFailure`；A5 WS `supervisor.action.decide`。
- Produces: `DigestCard.onDecideAction` prop、`TaskFailureCard`。

- [ ] **Step 1: Write failing tests**

```tsx
// DigestCard.test.tsx（追加）
it('renders one attention item and applies a safe retry proposal', async () => {
  const onDecideAction = vi.fn().mockResolvedValue(undefined)
  wrap(
    <DigestCard
      notice={{
        ...notice,
        payload: {
          ...notice.payload,
          attention: {
            items: [
              {
                taskId: 't1',
                title: '登录页修复',
                kind: 'failed',
                reason: '任务失败，建议重试',
                waitingSince: 10,
                proposalId: 'a1',
                action: { type: 'apply_proposal', proposalId: 'a1' },
              },
            ],
            counts: { approval: 0, reply: 0, review: 0, failed: 1, budget: 0, stale: 0 },
          },
        },
      }}
      onDecideAction={onDecideAction}
      onOpenTask={() => {}}
      onGenerate={() => {}}
    />,
  )
  expect(screen.getByText('需要你决定')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: '应用建议' }))
  expect(onDecideAction).toHaveBeenCalledWith('a1', 'apply')
})

it('hides the attention group when there is nothing for the human', () => {
  wrap(<DigestCard notice={notice} onOpenTask={() => {}} onGenerate={() => {}} />)
  expect(screen.queryByText('需要你决定')).toBeNull()
})
```

```tsx
// TaskFailureCard.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TaskFailureCard } from './TaskFailureCard'

describe('TaskFailureCard', () => {
  it('shows stage, summary, relative paths and retryability', () => {
    render(
      <TaskFailureCard
        failure={{
          stage: 'verify',
          lastError: 'pnpm test failed',
          retryable: true,
          affectedPaths: ['src/login.ts'],
          summary: '自动校验未通过',
          createdAt: 1,
        }}
      />,
    )
    expect(screen.getByText('最近失败')).toBeVisible()
    expect(screen.getByText('verify')).toBeVisible()
    expect(screen.getByText('自动校验未通过')).toBeVisible()
    expect(screen.getByText('src/login.ts')).toBeVisible()
    expect(screen.getByText('可重试')).toBeVisible()
  })

  it('renders nothing without a failure', () => {
    const { container } = render(<TaskFailureCard failure={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @baton/web test -- DigestCard TaskFailureCard`
Expected: FAIL because group/card do not exist.

- [ ] **Step 3: Implement web components**

`DigestCard.tsx`：

```tsx
import type { AttentionItem, DigestReport, Notice } from '@baton/protocol'
import { WaitingTime } from '../tasks/WaitingTime'

export function DigestCard({
  // ...existing props...
  onDecideAction,
}: {
  // ...existing props...
  onDecideAction?: (actionId: string, decision: 'apply' | 'ignore') => Promise<void> | void
}) {
  // ...existing body...
  const attention = report?.attention.items ?? []
  // 在变化摘要之后、blocked 列表之前渲染：
  {attention.length > 0 ? (
    <section aria-label="需要你决定" className="flex flex-col gap-1 rounded-md bg-default p-2">
      <h4 className="text-xs font-semibold text-foreground">需要你决定</h4>
      <ul className="flex flex-col gap-1">
        {attention.map((item: AttentionItem) => (
          <li key={item.taskId} className="flex flex-col gap-1 rounded-md px-1 py-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-foreground">{item.title}</span>
              {item.waitingSince !== null ? <WaitingTime since={item.waitingSince} /> : null}
            </div>
            <p className="text-xs text-muted">{item.reason}</p>
            {item.action.type === 'apply_proposal' ? (
              <Button
                variant="secondary"
                size="sm"
                onPress={() => void onDecideAction?.(item.action.proposalId, 'apply')}
              >
                应用建议
              </Button>
            ) : (
              <Button
                variant="tertiary"
                size="sm"
                onPress={() => onOpenTask?.(item.taskId)}
              >
                {item.action.type === 'open_review' ? '去验收' : '打开任务'}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  ) : null}
```

`SupervisorPanel.tsx` 传入：

```tsx
const send = useCommand()
const queryClient = useQueryClient()
<DigestCard
  workspaceId={workspaceId}
  onDecideAction={async (actionId, decision) => {
    await send({
      type: 'supervisor.action.decide',
      payload: { workspaceId, actionId, decision },
    })
    await queryClient.invalidateQueries({ queryKey: queryKeys.notices(workspaceId) })
    await queryClient.invalidateQueries({ queryKey: queryKeys.tasks(workspaceId) })
  }}
  // ...existing props
/>
```

`TaskFailureCard.tsx`：

```tsx
import type { FailureSummary } from '@baton/protocol'

export function TaskFailureCard({ failure }: { failure: FailureSummary | null }) {
  if (!failure) return null
  return (
    <section
      aria-label="最近失败"
      className="shrink-0 rounded-lg border border-danger bg-danger/10 p-3"
    >
      <h3 className="text-xs font-medium text-danger">最近失败</h3>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-md bg-default px-2 py-0.5 text-foreground">{failure.stage}</span>
        <span className="rounded-md bg-default px-2 py-0.5 text-muted">
          {failure.retryable ? '可重试' : '不可重试'}
        </span>
      </div>
      <p className="mt-2 text-xs text-foreground">{failure.summary}</p>
      <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-muted">
        {failure.lastError}
      </p>
      {failure.affectedPaths.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted">
          {failure.affectedPaths.map((path) => (
            <li key={path} className="break-all font-mono">
              {path}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
```

`TaskDetailPanel.tsx` 在 `TaskAutomationCard` 之后：

```tsx
{mobile ? (
  <MobileCollapsible title="最近失败">
    <TaskFailureCard failure={detail.lastFailure} />
  </MobileCollapsible>
) : (
  <TaskFailureCard failure={detail.lastFailure} />
)}
```

`TaskDetailPanel.test.tsx` 的 fixture 增加 `lastFailure: null`（如类型要求），并加一条断言：`lastFailure` 为 verify 时显示“自动校验未通过”。

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @baton/web test -- DigestCard TaskFailureCard TaskDetailPanel
pnpm --filter @baton/web typecheck
```

Expected: PASS；无 attention 时“需要你决定”不出现。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/supervisor apps/web/src/features/tasks apps/web/src/lib
git commit -m "feat(web): 展示需要你决定与最近失败"
```

---

### Task B6: 全量验证

Blocking: Task B1-B5
Slice type: verification
Seam: `pnpm verify` + tests

**Files:**
- No production files；只修复本计划引入的失败。

- [ ] **Step 1: Run full verify**

```bash
pnpm verify
```

Expected: 全绿。重点检查 protocol `automation.test.ts` 旧 payload 兼容、web 所有 `TaskDetailResponse` fixture 已补 `lastFailure`（或使用默认值）。

- [ ] **Step 2: Check privacy and no-transcript boundary**

```bash
grep -RIn "transcript" apps/daemon/src/failures apps/daemon/src/automation/digest.ts || true
grep -RIn "Users/\|/home/" apps/daemon/src/failures packages/core/src/failures.ts || true
```

Expected: 第一条无 transcript 读取；第二条只在注释/正则里出现，不写真实路径。

- [ ] **Step 3: Check counts invariant**

```bash
pnpm --filter @evanfang0054/baton test -- automation-digest supervisor-attention
```

Expected: PASS；`counts` 总和等于 `items.length`，最多 20。

- [ ] **Step 4: Update plan status and commit**

把本文件 `status: planned` 改为 `status: completed`。

```bash
git add docs/plans/2026-11-22-m6-5-attention-failure.md
git commit -m "docs(m6-5): 完成注意力与失败摘要计划"
```

---

## Plan B 完成标准

- `task_failure` 在 worker/verifier/budget/verify 失败路径各写一条；每任务保留 20 条。
- 失败摘要不含 transcript、绝对路径、token；`get_task_failure` 与 `get_task.lastFailure` 可读。
- digest 只列需要人的任务，一个任务一条，counts 等于 items 长度，最多 20。
- `attentionReminder`：off 不主动生成、observe 等下一次 digest、auto 立即生成且 24h 去重。
- DigestCard 无事项时安静；失败建议可应用，approve/reject/取消运行中只打开任务。

## 实施记录（2026-11-22）

- B1：`b68f957 feat(protocol): 增加注意力与失败摘要协议`
- B2：`8c12ce1 feat(core): 增加注意力合并与失败脱敏`
- B3：`107e3e3 feat(daemon): 写入脱敏失败摘要`
- B4：`f5f98dc feat(daemon): 收敛 digest 注意力`
- B5：`a7e1eea feat(web): 展示需要你决定与最近失败`
- B6：`7dd4366 fix(web): 补齐 lastFailure fixtures 与工具白名单`
- B6 验证：`pnpm verify` 全绿；failures/digest 无 transcript 读取、无本机绝对路径；`buildAttentionItems` 的 counts 总和等于 `items.length` 且最多 20。
