---
spec_ref: ../specs/2026-11-21-m6-task-scene-design.md
spec_topic: m6-task-scene
task_count: 6
estimated_phases: [tests, implementation, verification]
dod: 'M6-1 DoD 1-2、5-9、14-16：协议增量、现场/分组/注意力/初步验收纯函数、migration 0010'
status: active
depends_on: none
---

# M6-1 Plan 1：Protocol + Core + Migration 0010

> **For agentic workers:** REQUIRED SUB-SKILL: Use agent-harness:subagent-driven-development (recommended) or agent-harness:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先把协议增量、纯函数和数据库字段做对，让后续 daemon/web 只依赖稳定契约。

**Architecture:** 所有新逻辑先在 `packages/core` 写纯函数与测试；`packages/protocol` 只做 zod schema 增量；数据库只加 `review` 三列。现场、review 卡、分组坐标都不落新表。

**Tech Stack:** TypeScript ESM、zod 4、vitest、drizzle-kit。

**Commit strategy:** 按仓库先例，每个 task 末尾提交；若你希望最后统一提交，执行前告诉我。

---

## 文件结构

- `packages/protocol/src/commands.ts`：`node.update.groupId`、`node.move_many`、`group.create`。
- `packages/protocol/src/entities/review.ts`：`PreliminaryVerdict` 与 review 三字段。
- `packages/protocol/src/events.ts`：`review.preliminary` 事件并加入 `ServerMessage`。
- `packages/core/src/canvas/scene.ts`：任务现场投影。
- `packages/core/src/canvas/grouping.ts`：分组包围盒与中心点判定。
- `packages/core/src/tasks/board.ts`：`isStale`、`sortByWaiting`。
- `packages/core/src/review/preliminary.ts`：验收结论纯解析；daemon `observe.ts` 改为 re-export。
- `apps/daemon/src/db/schema.ts` 与 `apps/daemon/migrations/0010_m6_task_scene.sql`：review 三列。

---

### Task 1: Protocol 增量命令与 review 字段

Blocking: none
Slice type: tracer-bullet
Seam: `ClientMessage.parse` 与 `ServerMessage.parse`

**Files:**
- Modify: `packages/protocol/src/commands.ts`
- Modify: `packages/protocol/src/entities/review.ts`
- Modify: `packages/protocol/src/events.ts`
- Test: `packages/protocol/test/commands.test.ts`
- Test: `packages/protocol/test/events.test.ts`

**Interfaces:**
- Produces: `NodeMoveManyInput`、`GroupCreateInput`、`NodeUpdateInput.patch.groupId`、`PreliminaryVerdict`、`Review.preliminaryVerdict/reason/at`、`ReviewPreliminaryEvent`。

- [ ] **Step 1: 写失败测试**

```ts
// packages/protocol/test/commands.test.ts 追加
import { ClientMessage, GroupCreateInput, NodeMoveManyInput } from '../src/index.js'

it('accepts node.move_many and group.create', () => {
  const move = NodeMoveManyInput.parse({
    canvasId: 'c1',
    moves: [{ nodeId: 'n1', x: 10, y: 20 }],
  })
  expect(move.moves).toHaveLength(1)

  const group = GroupCreateInput.parse({
    canvasId: 'c1',
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    label: '需求',
    childIds: ['n1', 'n2'],
  })
  expect(group.childIds).toEqual(['n1', 'n2'])

  expect(
    ClientMessage.safeParse({
      v: 1,
      id: 'cmd1',
      ts: 1,
      type: 'node.move_many',
      payload: { canvasId: 'c1', moves: [{ nodeId: 'n1', x: 1, y: 2 }] },
    }).success,
  ).toBe(true)
})

it('accepts groupId in node.update patch', () => {
  expect(
    ClientMessage.safeParse({
      v: 1,
      id: 'cmd2',
      ts: 1,
      type: 'node.update',
      payload: { nodeId: 'n1', patch: { groupId: 'g1' } },
    }).success,
  ).toBe(true)
})
```

```ts
// packages/protocol/test/events.test.ts 追加
import { ReviewPreliminaryEvent } from '../src/index.js'

it('parses review.preliminary', () => {
  const event = ReviewPreliminaryEvent.parse({
    v: 1,
    ts: 1,
    type: 'review.preliminary',
    payload: { taskId: 't1', reviewId: 'r1', verdict: 'pass', at: 2 },
  })
  expect(event.payload.verdict).toBe('pass')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/protocol test -- commands events`
Expected: FAIL，`NodeMoveManyInput`/`GroupCreateInput`/`ReviewPreliminaryEvent` 未导出。

- [ ] **Step 3: 实现 schema**

```ts
// packages/protocol/src/commands.ts
export const NodeUpdateInput = z.object({
  nodeId: Id,
  patch: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().positive().optional(),
      h: z.number().positive().optional(),
      groupId: Id.nullable().optional(),
      data: z.unknown().optional(),
    })
    .strict(),
})

export const NodeMoveManyInput = z.object({
  canvasId: Id,
  moves: z
    .array(z.object({ nodeId: Id, x: z.number(), y: z.number() }).strict())
    .min(1)
    .max(200),
})

export const GroupCreateInput = z.object({
  canvasId: Id,
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  label: z.string().min(1).max(120),
  childIds: z.array(Id).min(1).max(50),
})

// ClientMessage 追加
CommandBase.extend({ type: z.literal('node.move_many'), payload: NodeMoveManyInput }),
CommandBase.extend({ type: z.literal('group.create'), payload: GroupCreateInput }),
```

```ts
// packages/protocol/src/entities/review.ts
export const PreliminaryVerdict = z.enum(['pass', 'fail', 'unknown'])
export type PreliminaryVerdict = z.infer<typeof PreliminaryVerdict>

export const Review = z.object({
  // ...existing fields
  preliminaryVerdict: PreliminaryVerdict.nullable().default(null),
  preliminaryReason: z.string().max(2000).nullable().default(null),
  preliminaryAt: Timestamp.nullable().default(null),
})
```

```ts
// packages/protocol/src/events.ts
export const ReviewPreliminaryEvent = EventBase.extend({
  type: z.literal('review.preliminary'),
  payload: z.object({
    taskId: Id,
    reviewId: Id,
    verdict: PreliminaryVerdict,
    at: Timestamp,
  }),
})

// ServerMessage 追加 ReviewPreliminaryEvent
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/protocol test -- commands events`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/protocol
git commit -m "feat(protocol): M6-1 画布节点与预验收契约"
```

---

### Task 2: Core 任务现场投影

Blocking: Task 1
Slice type: tracer-bullet
Seam: `buildTaskScene(task, nodes, edges)`

**Files:**
- Create: `packages/core/src/canvas/scene.ts`
- Create: `packages/core/src/canvas/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/scene.test.ts`

**Interfaces:**
- Consumes: `TaskDetail`、`Node`、`Edge` from `@baton/protocol`。
- Produces: `TaskScene`、`buildTaskScene(task: TaskDetail, nodes: Node[], edges: Edge[]): TaskScene`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import type { Edge, Node, TaskDetail } from '@baton/protocol'
import { buildTaskScene } from '../src/canvas/scene.js'

const agent = {
  id: 'a1', canvasId: 'c1', type: 'agent', x: 100, y: 100, w: 320, h: 200,
  groupId: null, createdAt: 1, updatedAt: 1,
  data: { title: 'Agent', engine: 'fake', taskId: 't1' },
} satisfies Node

const text = {
  id: 'n1', canvasId: 'c1', type: 'text', x: 0, y: 0, w: 320, h: 200,
  groupId: 'g1', createdAt: 1, updatedAt: 1, data: { content: '需求' },
} satisfies Node

const group = {
  id: 'g1', canvasId: 'c1', type: 'group', x: -20, y: -20, w: 400, h: 300,
  groupId: null, createdAt: 1, updatedAt: 1,
  data: { label: '需求区', collapsed: true },
} satisfies Node

const edge = {
  id: 'e1', canvasId: 'c1', sourceId: 'n1', targetId: 'a1', type: 'context', createdAt: 1,
} satisfies Edge

const task = {
  id: 't1', workspaceId: 'w1', nodeId: 'a1', title: '任务', prompt: '', status: 'review',
  waitingReason: null, engine: 'fake', workspaceMode: 'main', branch: null, worktreePath: null,
  verifyCommand: null, retryCount: 0, dangerouslySkipPermissions: false, createdAt: 1, updatedAt: 1,
  context: {
    included: [{ id: 'n1', type: 'text', title: '需求', depth: 0, chars: 2 }],
    dropped: [], truncated: false, redactedPaths: [], relations: [], relationsTruncated: false,
  },
  origin: {
    source: 'supervisor-chat', triggerId: 'tr1', threadId: 'th1',
    actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
    workspaceId: 'w1', targetNodeId: 'a1', contextNodeIds: ['n1'],
    policyVersion: 'p', promptVersion: 'v', createdAt: 1,
  },
} satisfies TaskDetail

describe('buildTaskScene', () => {
  it('collects target, context, origin, group expansion, edges and review card', () => {
    const scene = buildTaskScene(task, [agent, text, group], [edge])
    expect(scene.relatedNodeIds.sort()).toEqual(['a1', 'n1'])
    expect(scene.relatedEdgeIds).toEqual(['e1'])
    expect(scene.expandGroupIds).toEqual(['g1'])
    expect(scene.missingNodeIds).toEqual([])
    expect(scene.showReviewCard).toBe(true)
    expect(scene.reviewCardPosition).toEqual({ x: 460, y: 100 })
  })

  it('reports missing nodes and falls back review position', () => {
    const scene = buildTaskScene(task, [text, group], [edge])
    expect(scene.relatedNodeIds).toEqual(['n1'])
    expect(scene.missingNodeIds).toEqual(['a1'])
    expect(scene.reviewCardPosition).toEqual({ x: 0, y: 0 })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/core test -- scene`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
import type { Edge, Node, TaskDetail } from '@baton/protocol'

export interface TaskScene {
  taskId: string
  relatedNodeIds: string[]
  relatedEdgeIds: string[]
  expandGroupIds: string[]
  missingNodeIds: string[]
  showReviewCard: boolean
  reviewCardPosition: { x: number; y: number }
}

export function buildTaskScene(task: TaskDetail, nodes: Node[], edges: Edge[]): TaskScene {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const related = new Set<string>()
  if (task.nodeId) related.add(task.nodeId)
  for (const ref of task.context?.included ?? []) related.add(ref.id)
  for (const id of task.origin?.contextNodeIds ?? []) related.add(id)

  const existing = [...related].filter((id) => byId.has(id))
  const missing = [...related].filter((id) => !byId.has(id))
  const expandGroupIds = new Set<string>()
  for (const id of existing) {
    const groupId = byId.get(id)?.groupId
    if (!groupId) continue
    const group = byId.get(groupId)
    if (group?.type === 'group' && group.data.collapsed) expandGroupIds.add(groupId)
  }

  const relatedSet = new Set(existing)
  const relatedEdgeIds = edges
    .filter((edge) => relatedSet.has(edge.sourceId) && relatedSet.has(edge.targetId))
    .map((edge) => edge.id)

  const agent = task.nodeId ? byId.get(task.nodeId) : undefined
  return {
    taskId: task.id,
    relatedNodeIds: existing,
    relatedEdgeIds,
    expandGroupIds: [...expandGroupIds],
    missingNodeIds: missing,
    showReviewCard: task.status === 'review',
    reviewCardPosition: agent ? { x: agent.x + agent.w + 40, y: agent.y } : { x: 0, y: 0 },
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/core test -- scene`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core
git commit -m "feat(core): 任务现场投影"
```

---

### Task 3: Core 分组几何

Blocking: Task 1
Slice type: tracer-bullet
Seam: `findContainingGroup`

**Files:**
- Create: `packages/core/src/canvas/grouping.ts`
- Test: `packages/core/test/grouping.test.ts`

**Interfaces:**
- Produces: `NodeRect`、`groupBounds(nodes)`、`findContainingGroup(rect, groups)`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { findContainingGroup, groupBounds } from '../src/canvas/grouping.js'

const small = { id: 'g1', x: 0, y: 0, w: 200, h: 200 }
const large = { id: 'g2', x: -50, y: -50, w: 400, h: 400 }

it('uses node center and picks the smallest overlapping group', () => {
  expect(findContainingGroup({ x: 10, y: 10, w: 20, h: 20 }, [large, small])?.id).toBe('g1')
  expect(findContainingGroup({ x: 300, y: 300, w: 20, h: 20 }, [large, small])).toBeNull()
})

it('computes padded bounds', () => {
  expect(groupBounds([{ x: 10, y: 20, w: 100, h: 50 }], 24)).toEqual({
    x: -14, y: -4, w: 148, h: 98,
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/core test -- grouping`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
export interface NodeRect {
  x: number
  y: number
  w: number
  h: number
}

export function groupBounds(nodes: NodeRect[], padding = 24): NodeRect {
  const minX = Math.min(...nodes.map((node) => node.x)) - padding
  const minY = Math.min(...nodes.map((node) => node.y)) - padding
  const maxX = Math.max(...nodes.map((node) => node.x + node.w)) + padding
  const maxY = Math.max(...nodes.map((node) => node.y + node.h)) + padding
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function findContainingGroup<T extends NodeRect & { id: string }>(
  rect: NodeRect,
  groups: T[],
): T | null {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const hits = groups.filter(
    (group) =>
      cx >= group.x && cx <= group.x + group.w && cy >= group.y && cy <= group.y + group.h,
  )
  hits.sort((a, b) => a.w * a.h - b.w * b.h)
  return hits[0] ?? null
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/core test -- grouping`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core
git commit -m "feat(core): 分组成员几何"
```

---

### Task 4: Core 注意力 stale 与排序

Blocking: none
Slice type: tracer-bullet
Seam: `isStale` / `sortByWaiting`

**Files:**
- Modify: `packages/core/src/tasks/board.ts`
- Test: `packages/core/test/board.test.ts`

**Interfaces:**
- Produces: `isStale(waitingSince: number | null, now: number, thresholdMs?: number): boolean`、`sortByWaiting<T extends { waitingSince: number | null }>(tasks: T[]): T[]`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { isStale, sortByWaiting } from '../src/tasks/board.js'

it('marks 30 minutes stale inclusively', () => {
  const now = 10_000_000
  expect(isStale(now - 30 * 60 * 1000, now)).toBe(true)
  expect(isStale(now - 30 * 60 * 1000 + 1, now)).toBe(false)
  expect(isStale(null, now)).toBe(false)
})

it('sorts oldest waiting first and keeps nulls last', () => {
  const rows = [
    { id: 'c', waitingSince: null },
    { id: 'b', waitingSince: 2 },
    { id: 'a', waitingSince: 1 },
  ]
  expect(sortByWaiting(rows).map((row) => row.id)).toEqual(['a', 'b', 'c'])
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/core test -- board`
Expected: FAIL，`isStale`/`sortByWaiting` 未导出。

- [ ] **Step 3: 实现**

```ts
export const STALE_THRESHOLD_MS = 30 * 60 * 1000

export function isStale(
  waitingSince: number | null,
  now: number,
  thresholdMs = STALE_THRESHOLD_MS,
): boolean {
  return waitingSince !== null && waitingSince <= now - thresholdMs
}

export function sortByWaiting<T extends { waitingSince: number | null }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.waitingSince === null && b.waitingSince === null) return 0
    if (a.waitingSince === null) return 1
    if (b.waitingSince === null) return -1
    return a.waitingSince - b.waitingSince
  })
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/core test -- board`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core
git commit -m "feat(core): 挂起任务 stale 与排序"
```

---

### Task 5: Core 预验收结论解析

Blocking: none
Slice type: refactor
Seam: `parsePreliminaryVerdict`

**Files:**
- Create: `packages/core/src/review/preliminary.ts`
- Create: `packages/core/src/review/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/daemon/src/supervisor/observe.ts`
- Test: `packages/core/test/preliminary.test.ts`

**Interfaces:**
- Produces: `PreliminaryVerdict`、`parsePreliminaryVerdict(text, outcomeReason?)`。
- 保持 daemon `observe.ts` 的 `parseVerdict` 导出兼容。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { parsePreliminaryVerdict } from '../src/review/preliminary.js'

it('uses the last verdict line', () => {
  expect(
    parsePreliminaryVerdict('VERDICT: FAIL\n理由\nVERDICT: PASS').verdict,
  ).toBe('pass')
})

it('falls back to outcome reason only for clear words', () => {
  expect(parsePreliminaryVerdict('', '满足要求，已完成').verdict).toBe('pass')
  expect(parsePreliminaryVerdict('', '不满足要求，需要修改').verdict).toBe('fail')
  expect(parsePreliminaryVerdict('', '看情况').verdict).toBe('unknown')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/core test -- preliminary`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现并下沉**

把 `apps/daemon/src/supervisor/observe.ts` 现有的 `parseVerdict` 主体原样移动到 `packages/core/src/review/preliminary.ts`，导出：

```ts
export type PreliminaryVerdict = 'pass' | 'fail' | 'unknown'

export interface ParsedPreliminary {
  verdict: PreliminaryVerdict
  reason: string
}

export function parsePreliminaryVerdict(
  text: string,
  outcomeReason?: string | null,
): ParsedPreliminary {
  // 原样保留 observe.ts 的正则、取最后一次、reason 截断与 outcome 兜底逻辑
}
```

`apps/daemon/src/supervisor/observe.ts` 改为：

```ts
export {
  parsePreliminaryVerdict as parseVerdict,
  type PreliminaryVerdict as Verdict,
  type ParsedPreliminary as ParsedVerdict,
} from '@baton/core'
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/core test -- preliminary`
Run: `pnpm --filter @evanfang0054/baton test -- observe`
Expected: 两组 PASS；daemon 既有 `parseVerdict` 调用不回归。

- [ ] **Step 5: 提交**

```bash
git add packages/core apps/daemon/src/supervisor/observe.ts
git commit -m "refactor(core): 下沉预验收结论解析"
```

---

### Task 6: Migration 0010 与 schema

Blocking: Task 1
Slice type: tracer-bullet
Seam: fixture DB 升级

**Files:**
- Modify: `apps/daemon/src/db/schema.ts`
- Create: `apps/daemon/migrations/0010_m6_task_scene.sql`
- Modify: `apps/daemon/migrations/meta/_journal.json`
- Test: `apps/daemon/test/migrations-m6.test.ts`

**Interfaces:**
- Produces: `review.preliminary_verdict/preliminary_reason/preliminary_at`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'

it('adds preliminary columns to old review rows', () => {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: 'migrations' })
  sqlite
    .prepare(
      `insert into review (id, task_id, verdict, verify_exit_code, verify_output, diff_stat_json)
       values ('r1', 't1', null, 0, '', '{"filesChanged":0,"insertions":0,"deletions":0}')`,
    )
    .run()
  const row = sqlite.prepare('select * from review where id = ?').get('r1') as Record<string, unknown>
  expect(row.preliminary_verdict).toBeNull()
  expect(row.preliminary_reason).toBeNull()
  expect(row.preliminary_at).toBeNull()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- migrations-m6`
Expected: FAIL，列不存在。

- [ ] **Step 3: 修改 schema 并生成 migration**

`schema.ts`：

```ts
export const review = sqliteTable('review', {
  // ...existing
  preliminaryVerdict: text('preliminary_verdict'),
  preliminaryReason: text('preliminary_reason'),
  preliminaryAt: integer('preliminary_at'),
})
```

Run: `pnpm --filter @evanfang0054/baton exec drizzle-kit generate --name m6_task_scene`
Expected: 生成 `0010_m6_task_scene.sql` 与 journal 条目；确认 SQL 只有三条 `ALTER TABLE review ADD`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @evanfang0054/baton test -- migrations-m6`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/db/schema.ts apps/daemon/migrations
git commit -m "feat(daemon): review 预验收字段与 migration 0010"
```

---

## 验收

```bash
pnpm --filter @baton/protocol test
pnpm --filter @baton/core test
pnpm --filter @evanfang0054/baton test -- migrations-m6 observe
pnpm typecheck
pnpm format:check
```

Expected: 全部通过。Plan 2 依赖本 plan 的协议、纯函数与 migration。
