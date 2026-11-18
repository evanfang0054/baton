---
spec_ref: ../specs/2026-11-18-m1-6b-canvas-context-design.md
spec_topic: m1-6b-canvas-context
task_count: 7
estimated_phases: [tests, implementation, verification]
dod: "协议快照/边命令/TaskDetail、migration 0005、core 关系渲染与预算、daemon 边服务、任务快照持久化、级联删边、详情返回 TaskDetail；pnpm verify 全绿"
depends_on: []
status: active
---

# M1-6b 画布上下文后端实施计划（Plan 1/2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让任务是真正「带画布上下文」创建的：协议有快照与边命令，迁移能落地，core 把节点关系渲染进 prompt，daemon 能边 CRUD、存快照、级联删边，详情返回可解释的 `context`。

**Architecture:** 自下而上：protocol → core → migration/repository → daemon。Plan 2 只消费这里产出的命令与 `TaskDetail.context`，不再改 core。

**Tech Stack:** TypeScript ESM、zod 4、Drizzle / better-sqlite3、Fastify 5、vitest。

---

## 计划地图

| Plan | 范围 | 状态 |
|---|---|---|
| **1. 后端（本计划）** | protocol/core/migration/daemon | 待实施 |
| 2. Web 画布与验收 | 多选、连线、chips、详情快照、e2e、ego-lite | 待写；依赖本计划 |

**GDD:** 按仓库 M1-1 先例显式跳过；测试设计由 `docs/contracts/M1-6b-canvas-context.contract.md` 的 21 条 DoD 与任务内测试矩阵承担。

**Commit strategy:** 每个 Task 结束提交一次；Task 7 跑全量 `pnpm verify`。

---

## Task 1: Protocol 快照、TaskDetail 与边命令

Blocking: none
Slice type: tracer-bullet
Seam: `ClientMessage.parse` 与 `ContextSnapshot.parse`

**Files:**

- Create: `packages/protocol/src/context.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/entities/task.ts`
- Modify: `packages/protocol/src/commands.ts`
- Modify: `packages/protocol/src/api.ts`
- Create: `packages/protocol/test/context.test.ts`
- Modify: `packages/protocol/test/commands.test.ts`
- Modify: `packages/protocol/test/exports.test.ts`

**Interfaces:**

- Produces: `DropReason`、`ContextNodeRef`、`ContextDropped`、`ContextRelation`、`ContextSnapshot`、`TaskDetail`、`EdgeCreateInput`、`EdgeDeleteInput`。
- `TaskDetailResponse.task` 变为 `TaskDetail`。

- [ ] **Step 1: 写失败测试**

`packages/protocol/test/context.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { ContextSnapshot, TaskDetail } from '../src/index.js'

const snapshot = {
  included: [{ id: 'n1', type: 'text' as const, title: '需求', depth: 0, chars: 12 }],
  dropped: [{ id: 'n2', reason: 'sensitive' as const, title: '.env' }],
  truncated: false,
  redactedPaths: ['.env'],
  relations: [
    {
      from: 'n1',
      to: 'n3',
      type: 'context' as const,
      fromTitle: '需求',
      toTitle: '接口设计',
      includedFrom: true,
      includedTo: false,
    },
  ],
  relationsTruncated: false,
}

describe('ContextSnapshot', () => {
  it('parses a complete snapshot', () => {
    expect(ContextSnapshot.parse(snapshot)).toEqual(snapshot)
  })

  it('rejects unknown drop reasons', () => {
    expect(() =>
      ContextSnapshot.parse({
        ...snapshot,
        dropped: [{ id: 'n2', reason: 'nope' }],
      }),
    ).toThrow()
  })
})

describe('TaskDetail', () => {
  it('defaults context to null for old tasks', () => {
    const task = {
      id: 't1',
      workspaceId: 'w1',
      nodeId: 'n1',
      title: 'demo',
      prompt: '<task>demo</task>',
      status: 'todo' as const,
      waitingReason: null,
      engine: 'fake' as const,
      workspaceMode: 'main' as const,
      branch: null,
      worktreePath: null,
      verifyCommand: null,
      retryCount: 0,
      dangerouslySkipPermissions: false,
      createdAt: 1,
      updatedAt: 1,
    }
    expect(TaskDetail.parse(task).context).toBeNull()
    expect(TaskDetail.parse({ ...task, context: snapshot }).context).toEqual(snapshot)
  })
})
```

`packages/protocol/test/commands.test.ts` 的 `fixtures` 追加：

```ts
['edge.create', { sourceId: 'n1', targetId: 'n2' }],
['edge.create', { sourceId: 'n1', targetId: 'n2', type: 'context' }],
['edge.delete', { edgeId: 'e1' }],
```

`packages/protocol/test/exports.test.ts` 的 `schemaNames` 追加：
`DropReason`、`ContextNodeRef`、`ContextDropped`、`ContextRelation`、`ContextSnapshot`、`TaskDetail`、`EdgeCreateInput`、`EdgeDeleteInput`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/protocol test`
Expected: FAIL，`ContextSnapshot`/`TaskDetail` 未导出，`edge.create` 无法解析。

- [ ] **Step 3: 实现 `packages/protocol/src/context.ts`**

```ts
import { z } from 'zod'
import { Id } from './common.js'
import { EdgeType, NodeType } from './enums.js'

export const DropReason = z.enum(['budget', 'sensitive', 'limit', 'not_found', 'target', 'empty'])
export type DropReason = z.infer<typeof DropReason>

export const ContextNodeRef = z.object({
  id: Id,
  type: NodeType,
  title: z.string(),
  depth: z.number().int().nonnegative(),
  chars: z.number().int().nonnegative(),
})
export type ContextNodeRef = z.infer<typeof ContextNodeRef>

export const ContextDropped = z.object({
  id: Id,
  reason: DropReason,
  title: z.string().optional(),
})
export type ContextDropped = z.infer<typeof ContextDropped>

export const ContextRelation = z.object({
  from: Id,
  to: Id,
  type: EdgeType,
  fromTitle: z.string(),
  toTitle: z.string(),
  includedFrom: z.boolean(),
  includedTo: z.boolean(),
})
export type ContextRelation = z.infer<typeof ContextRelation>

export const ContextSnapshot = z.object({
  included: z.array(ContextNodeRef),
  dropped: z.array(ContextDropped),
  truncated: z.boolean(),
  redactedPaths: z.array(z.string()),
  relations: z.array(ContextRelation),
  relationsTruncated: z.boolean(),
})
export type ContextSnapshot = z.infer<typeof ContextSnapshot>
```

- [ ] **Step 4: 接线 protocol**

`packages/protocol/src/index.ts` 增加 `export * from './context.js'`。

`packages/protocol/src/entities/task.ts`：

```ts
import { ContextSnapshot } from '../context.js'

export const TaskDetail = Task.extend({
  context: ContextSnapshot.nullable().default(null),
})
export type TaskDetail = z.infer<typeof TaskDetail>
```

`packages/protocol/src/commands.ts`：

```ts
export const EdgeCreateInput = z.object({
  sourceId: Id,
  targetId: Id,
  type: EdgeType.default('context'),
})
export type EdgeCreateInput = z.infer<typeof EdgeCreateInput>

export const EdgeDeleteInput = z.object({ edgeId: Id })
export type EdgeDeleteInput = z.infer<typeof EdgeDeleteInput>
```

并在 `ClientMessage` discriminated union 追加：

```ts
CommandBase.extend({ type: z.literal('edge.create'), payload: EdgeCreateInput }),
CommandBase.extend({ type: z.literal('edge.delete'), payload: EdgeDeleteInput }),
```

`packages/protocol/src/api.ts`：`TaskDetailResponse.task` 改为 `TaskDetail`，并从 `./entities/task.js` 导入。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @baton/protocol test`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/protocol
git commit -m "feat(protocol): 上下文快照、TaskDetail 与边命令"
```

---

## Task 2: 数据模型与 migration 0005

Blocking: Task 1
Slice type: tracer-bullet
Seam: `task.context_json` 列与 `edge_unique_idx`

**Files:**

- Modify: `apps/daemon/src/db/schema.ts`
- Create: `apps/daemon/migrations/0005_*.sql`（drizzle-kit 生成后手工插入去重语句）
- Create: `apps/daemon/migrations/meta/0005_snapshot.json`（生成）
- Modify: `apps/daemon/migrations/meta/_journal.json`（生成）
- Modify: `apps/daemon/test/migrate.test.ts`

**Interfaces:**

- `task` 表新增 `contextJson: text('context_json')`。
- `edge` 表新增唯一索引 `edge_unique_idx`。

- [ ] **Step 1: 写失败测试**

`apps/daemon/test/migrate.test.ts` 的索引断言追加 `edge_unique_idx`：

```ts
expect(
  before
    .filter((row) => row.type === 'index')
    .map((row) => row.name)
    .sort(),
).toEqual([
  'approval_session_request_idx',
  'audit_ts_idx',
  'edge_unique_idx',
  'event_ordinal_idx',
  'event_session_seq_idx',
  'node_canvas_idx',
  'task_status_idx',
  'workspace_rel_path_unique',
  'ws_event_id_unique',
  'ws_event_ts_idx',
])
```

新增用例：先迁移到 0004、插入重复边、再迁移到 0005：

```ts
it('dedupes edges before creating the unique index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'baton-edge-dedupe-'))
  dirs.push(dir)
  const oldMigrations = join(dir, 'old-migrations')
  mkdirSync(join(oldMigrations, 'meta'), { recursive: true })
  for (const name of [
    '0000_married_hannibal_king.sql',
    '0001_cheerful_xavin.sql',
    '0002_glorious_cardiac.sql',
    '0003_workspace_trust.sql',
    '0004_permissions_and_questions.sql',
  ]) {
    copyFileSync(join(migrationsDir, name), join(oldMigrations, name))
  }
  const fullJournal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; when: number; tag: string; version: string; breakpoints: boolean }> }
  writeFileSync(
    join(oldMigrations, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: fullJournal.entries.filter((entry) => entry.idx <= 4),
    }),
  )

  process.env.BATON_MIGRATIONS_DIR = oldMigrations
  const db = openDb(join(dir, 'old.db'))
  migrateDb(db)
  db.prepare(
    `insert into workspace (id, name, rel_path, created_at) values ('w1', 'demo', 'demo', 1)`,
  ).run()
  db.prepare(
    `insert into canvas (id, workspace_id, viewport_json) values ('c1', 'w1', '{"x":0,"y":0,"zoom":1}')`,
  ).run()
  for (const id of ['n1', 'n2']) {
    db.prepare(
      `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
       values (?, 'c1', 'text', 0, 0, 320, 200, null, '{"content":"x"}', 1, 1)`,
    ).run(id)
  }
  db.prepare(
    `insert into edge (id, canvas_id, source_id, target_id, type) values
     ('e1', 'c1', 'n1', 'n2', 'context'),
     ('e2', 'c1', 'n1', 'n2', 'context')`,
  ).run()

  process.env.BATON_MIGRATIONS_DIR = migrationsDir
  migrateDb(db)

  const rows = db.prepare(`select id from edge order by id`).all() as Array<{ id: string }>
  expect(rows).toEqual([{ id: 'e1' }])
  expect(
    db
      .prepare(`select name from sqlite_master where type = 'index' and name = 'edge_unique_idx'`)
      .get(),
  ).toEqual({ name: 'edge_unique_idx' })
  db.close()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- migrate`
Expected: FAIL，`edge_unique_idx` 不存在。

- [ ] **Step 3: 改 schema**

`apps/daemon/src/db/schema.ts`：

```ts
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const edge = sqliteTable(
  'edge',
  {
    id: text('id').primaryKey(),
    canvasId: text('canvas_id').notNull().references(() => canvas.id),
    sourceId: text('source_id').notNull().references(() => node.id),
    targetId: text('target_id').notNull().references(() => node.id),
    type: text('type').notNull().default('context'),
  },
  (t) => [uniqueIndex('edge_unique_idx').on(t.canvasId, t.sourceId, t.targetId, t.type)],
)
```

`task` 表新增：

```ts
contextJson: text('context_json'),
```

- [ ] **Step 4: 生成 migration 并插入去重**

Run:

```bash
cd apps/daemon && pnpm exec drizzle-kit generate
```

打开生成的 `0005_*.sql`，在 `CREATE UNIQUE INDEX` 之前插入：

```sql
DELETE FROM `edge`
WHERE `id` NOT IN (
  SELECT MIN(`id`) FROM `edge`
  GROUP BY `canvas_id`, `source_id`, `target_id`, `type`
);
```

确认 SQL 同时包含：

```sql
ALTER TABLE `task` ADD `context_json` text;
```

- [ ] **Step 5: 跑迁移测试**

Run: `pnpm --filter @evanfang0054/baton test -- migrate`
Expected: PASS，重复边只剩 `e1`，索引存在。

- [ ] **Step 6: 提交**

```bash
git add apps/daemon/src/db/schema.ts apps/daemon/migrations apps/daemon/test/migrate.test.ts
git commit -m "feat(daemon): 上下文快照列与边唯一索引"
```

---

## Task 3: core 关系渲染与快照字段

Blocking: Task 1
Slice type: tracer-bullet
Seam: `assembleContext` 返回值与 prompt 快照

**Files:**

- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/assemble.ts`
- Modify: `packages/core/test/context.test.ts`

**Interfaces:**

- Consumes: `ContextNodeRef`、`ContextDropped`、`ContextRelation`、`DropReason`（来自 `@baton/protocol`）。
- Produces: `AssembleContextResult` 新增 `relations`、`relationsTruncated`；`included` 项新增 `title`；`dropped` 项新增可选 `title`。

- [ ] **Step 1: 写失败测试**

在 `packages/core/test/context.test.ts` 新增：

```ts
it('renders relations touching included nodes or the target', () => {
  const result = assembleContext({
    taskPrompt: '总结约束',
    targetNodeId: 'n4',
    selectedNodeIds: ['n1', 'n2'],
    nodes,
    edges: [
      edge('e1', 'n1', 'n4'),
      edge('e2', 'n2', 'n1'),
      edge('e3', 'n5', 'n4'),
      edge('e4', 'n7', 'n8'),
    ],
  })

  expect(result.prompt).toContain('<relations>')
  expect(result.prompt).toContain('<edge from="n1" to="n4" type="context" from_title="PRD" to_title="Agent"/>')
  expect(result.prompt).toContain('<edge from="n2" to="n1" type="context" from_title="设计稿" to_title="PRD"/>')
  expect(result.prompt).toContain('<edge from="n5" to="n4" type="context" from_title="review" to_title="Agent"/>')
  expect(result.prompt).not.toContain('from="n7" to="n8"')
  expect(result.relations.map((item) => item.from)).toEqual(['n2', 'n1', 'n5'])
  expect(result.relations.every((item) => typeof item.fromTitle === 'string')).toBe(true)
})

it('omits the relations block when no edge touches the context', () => {
  const result = assembleContext({
    taskPrompt: 'x',
    targetNodeId: 'n4',
    selectedNodeIds: ['n1'],
    nodes,
    edges: [],
  })
  expect(result.prompt).not.toContain('<relations>')
  expect(result.relations).toEqual([])
  expect(result.relationsTruncated).toBe(false)
})

it('caps relations at 200 edges and marks truncation', () => {
  const many = Array.from({ length: 201 }, (_, index) =>
    edge(`e${index}`, 'n1', 'n2'),
  )
  const result = assembleContext({
    taskPrompt: 'x',
    targetNodeId: 'n4',
    selectedNodeIds: ['n1', 'n2'],
    nodes,
    edges: many,
  })
  expect(result.relations).toHaveLength(200)
  expect(result.relationsTruncated).toBe(true)
  expect(result.prompt).toContain('<relations truncated="true">')
})
```

同时更新既有断言：`result.included` 现在含 `title`；含目标的直连边会新增 `<relations>` 段。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/core test -- context`
Expected: FAIL，`relations` 未定义、prompt 无 `<relations>`。

- [ ] **Step 3: 更新 types**

`packages/core/src/context/types.ts`：

```ts
import type {
  ContextDropped,
  ContextNodeRef,
  ContextRelation,
  DropReason,
  Edge,
  Node,
} from '@baton/protocol'

export type { DropReason }

export interface AssembleContextResult {
  prompt: string
  included: ContextNodeRef[]
  dropped: ContextDropped[]
  truncated: boolean
  redactedPaths: string[]
  relations: ContextRelation[]
  relationsTruncated: boolean
}
```

删除本地 `DropReason` 定义；`context/index.ts` 继续导出即可。

- [ ] **Step 4: 实现关系渲染**

`packages/core/src/context/assemble.ts`：

1. 增加全类型标题函数：

```ts
function nodeTitle(node: Node): string {
  switch (node.type) {
    case 'text':
      return titleOf(node)
    case 'file':
      return node.data.name
    case 'image':
      return node.data.alt ?? 'image'
    case 'agent':
      return node.data.title
    case 'group':
      return node.data.label
    case 'review':
      return 'review'
  }
}
```

2. `included` 映射增加 `title: nodeTitle(item.node)`。

3. 在内容预算处理完成后、组装 `parts` 之前计算关系：

```ts
const includedIds = new Set(rendered.map((item) => item.node.id))
const scope = new Set([...includedIds, input.targetNodeId])
const relationCandidates = input.edges
  .filter((edge) => scope.has(edge.sourceId) || scope.has(edge.targetId))
  .map((edge) => {
    const from = byId.get(edge.sourceId)
    const to = byId.get(edge.targetId)
    if (!from || !to) return null
    return {
      from: edge.sourceId,
      to: edge.targetId,
      type: edge.type,
      fromTitle: nodeTitle(from),
      toTitle: nodeTitle(to),
      includedFrom: includedIds.has(edge.sourceId),
      includedTo: includedIds.has(edge.targetId),
    } satisfies ContextRelation
  })
  .filter((item): item is ContextRelation => item !== null)
  .sort((a, b) => {
    const priority = Number(!(a.includedFrom && a.includedTo)) - Number(!(b.includedFrom && b.includedTo))
    return (
      priority ||
      a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to) ||
      a.type.localeCompare(b.type)
    )
  })

const MAX_RELATIONS = 200
const MAX_RELATION_CHARS = 4_000
const relationLines: string[] = []
const renderedRelations: ContextRelation[] = []
let relationChars = 0
let relationsTruncated = false

for (const relation of relationCandidates) {
  const line =
    `<edge from="${escapeAttr(relation.from)}" to="${escapeAttr(relation.to)}" ` +
    `type="${relation.type}" from_title="${escapeAttr(relation.fromTitle)}" ` +
    `to_title="${escapeAttr(relation.toTitle)}"/>`
  if (relationLines.length >= MAX_RELATIONS || relationChars + line.length > MAX_RELATION_CHARS) {
    relationsTruncated = true
    break
  }
  relationLines.push(line)
  renderedRelations.push(relation)
  relationChars += line.length
}
```

4. `parts` 追加：

```ts
if (relationLines.length > 0) {
  const attr = relationsTruncated ? ' truncated="true"' : ''
  parts.push(`<relations${attr}>\n${relationLines.join('\n')}\n</relations>`)
}
```

5. 返回值增加 `relations` 与 `relationsTruncated`；`relations` 只包含实际渲染项：

```ts
return {
  prompt: parts.join('\n'),
  included,
  dropped: droppedList,
  truncated,
  redactedPaths,
  relations: renderedRelations,
  relationsTruncated,
}
```

其中 `renderedRelations` 与 `relationLines` 同步 push。

6. `droppedList` 映射增加标题：

```ts
const droppedList = [...dropped.entries()]
  .map(([id, reason]) => {
    const node = byId.get(id)
    return { id, reason, ...(node ? { title: nodeTitle(node) } : {}) }
  })
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @baton/core test -- context`
Expected: PASS；`pnpm --filter @baton/core test` 全绿。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/context packages/core/test/context.test.ts
git commit -m "feat(core): 上下文关系渲染与快照字段"
```

---

## Task 4: daemon 边服务与命令分发

Blocking: Task 2
Slice type: tracer-bullet
Seam: `edge.create/delete` 命令 ack

**Files:**

- Create: `apps/daemon/src/runtime/edge-service.ts`
- Modify: `apps/daemon/src/db/repositories.ts`
- Modify: `apps/daemon/src/runtime/index.ts`
- Modify: `apps/daemon/test/repositories.test.ts`
- Create: `apps/daemon/test/edge-service.test.ts`

**Interfaces:**

- Produces: `createEdge(deps, input): CreateEdgeResult`、`deleteEdge(deps, input): DeleteEdgeResult`。
- `getEdge(db, id)`、`findEdge(db, { canvasId, sourceId, targetId, type })`、`insertEdge(tx, edge)`、`deleteEdgeById(tx, id)`、`deleteEdgesForNode(tx, nodeId)`。

- [ ] **Step 1: 写失败测试**

`apps/daemon/test/edge-service.test.ts`：

```ts
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createTestDb, seedTask } from './helpers/db.js'
import { createEdge, deleteEdge } from '../src/runtime/edge-service.js'
```

跨画布用例：再建一个 workspace/canvas/node，断言 `edge_cross_canvas`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- edge-service`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现仓储函数**

`apps/daemon/src/db/repositories.ts`：

```ts
export function getEdge(db: Db, id: string): Edge | null {
  const row = db.select().from(edge).where(eq(edge.id, id)).get()
  return row ? toEdge(row) : null
}

export function findEdge(
  db: Db,
  input: { canvasId: string; sourceId: string; targetId: string; type: string },
): Edge | null {
  const row = db
    .select()
    .from(edge)
    .where(
      and(
        eq(edge.canvasId, input.canvasId),
        eq(edge.sourceId, input.sourceId),
        eq(edge.targetId, input.targetId),
        eq(edge.type, input.type),
      ),
    )
    .get()
  return row ? toEdge(row) : null
}

export function insertEdge(tx: Tx, value: Edge): void {
  tx.insert(edge)
    .values({
      id: value.id,
      canvasId: value.canvasId,
      sourceId: value.sourceId,
      targetId: value.targetId,
      type: value.type,
    })
    .run()
}

export function deleteEdgeById(tx: Tx, id: string): void {
  tx.delete(edge).where(eq(edge.id, id)).run()
}

export function deleteEdgesForNode(tx: Tx, nodeId: string): void {
  tx.delete(edge).where(or(eq(edge.sourceId, nodeId), eq(edge.targetId, nodeId))).run()
}
```

- [ ] **Step 4: 实现 edge-service**

`apps/daemon/src/runtime/edge-service.ts`：

```ts
import { Edge, type AppError, type EdgeCreateInput, type EdgeDeleteInput } from '@baton/protocol'
import type { Db } from '../db/types.js'
import {
  deleteEdgeById,
  findEdge,
  getEdge,
  getNode,
  insertEdge,
} from '../db/repositories.js'
import { appError, toAppError } from '../errors.js'

export interface EdgeServiceDeps {
  db: Db
  newId: () => string
}

export type EdgeResult = { ok: true; edgeId: string } | { ok: false; error: AppError }

export function createEdge(deps: EdgeServiceDeps, input: EdgeCreateInput): EdgeResult {
  try {
    const source = getNode(deps.db, input.sourceId)
    const target = getNode(deps.db, input.targetId)
    const missing = [
      ...(source ? [] : [input.sourceId]),
      ...(target ? [] : [input.targetId]),
    ]
    if (!source || !target) {
      return {
        ok: false,
        error: appError('node_not_found', 'edge endpoint not found', { nodeIds: missing }),
      }
    }
    if (source.canvasId !== target.canvasId) {
      return {
        ok: false,
        error: appError('edge_cross_canvas', 'edge endpoints must share a canvas', {
          sourceId: source.id,
          targetId: target.id,
        }),
      }
    }
    if (source.id === target.id) {
      return {
        ok: false,
        error: appError('edge_self_loop', 'an edge cannot point to itself', { nodeId: source.id }),
      }
    }
    if (
      findEdge(deps.db, {
        canvasId: source.canvasId,
        sourceId: source.id,
        targetId: target.id,
        type: input.type,
      })
    ) {
      return {
        ok: false,
        error: appError('edge_duplicate', 'edge already exists', {
          sourceId: source.id,
          targetId: target.id,
        }),
      }
    }

    const edgeId = deps.newId()
    deps.db.transaction((tx) =>
      insertEdge(
        tx,
        Edge.parse({
          id: edgeId,
          canvasId: source.canvasId,
          sourceId: source.id,
          targetId: target.id,
          type: input.type,
        }),
      ),
    )
    return { ok: true, edgeId }
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed')) {
      return { ok: false, error: appError('edge_duplicate', 'edge already exists') }
    }
    return { ok: false, error: toAppError(error) }
  }
}

export function deleteEdge(
  deps: EdgeServiceDeps,
  input: EdgeDeleteInput,
): { ok: true } | { ok: false; error: AppError } {
  const existing = getEdge(deps.db, input.edgeId)
  if (!existing) {
    return { ok: false, error: appError('edge_not_found', 'edge not found', { edgeId: input.edgeId }) }
  }
  deps.db.transaction((tx) => deleteEdgeById(tx, existing.id))
  return { ok: true }
}
```

- [ ] **Step 5: 接命令分发**

`apps/daemon/src/runtime/index.ts` 在 `handleCommand` 的 `switch` 增加：

```ts
case 'edge.create': {
  const result = createEdge({ db: deps.db, newId }, message.payload)
  return result.ok
    ? { ok: true, ack: { edgeId: result.edgeId } }
    : { ok: false, error: result.error }
}
case 'edge.delete': {
  const result = deleteEdge({ db: deps.db, newId }, message.payload)
  return result.ok ? { ok: true, ack: {} } : { ok: false, error: result.error }
}
```

- [ ] **Step 6: 跑测试**

Run: `pnpm --filter @evanfang0054/baton test -- edge-service ws-router`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/daemon/src/runtime/edge-service.ts apps/daemon/src/runtime/index.ts apps/daemon/src/db/repositories.ts apps/daemon/test/edge-service.test.ts
git commit -m "feat(daemon): 边创建/删除命令与校验"
```

---

## Task 5: 任务快照持久化与详情返回

Blocking: Task 2, Task 3
Slice type: tracer-bullet
Seam: `task.context_json` 写入与 `TaskDetailResponse.task.context`

**Files:**

- Modify: `apps/daemon/src/db/repositories.ts`
- Modify: `apps/daemon/src/runtime/task-service.ts`
- Modify: `apps/daemon/src/http/tasks.ts`
- Modify: `apps/daemon/src/app.ts`
- Modify: `apps/daemon/test/task-service.test.ts`
- Modify: `apps/daemon/test/rest-api.test.ts`

**Interfaces:**

- `insertTask(tx, input: Task, contextJson: string | null = null)`。
- `getTaskDetail(db, id): { task: TaskDetail; contextInvalid: boolean } | null`。
- `registerTaskRoutes(app, { db, logger })`。

- [ ] **Step 1: 写失败测试**

`apps/daemon/test/task-service.test.ts` 新增：

```ts
it('persists a context snapshot from the same assembly', () => {
  const { database, seeded, service } = setup()
  const result = service.createTask(input(seeded))
  expect(result.ok).toBe(true)
  if (!result.ok) return

  const raw = database.raw
    .prepare('select context_json from task where id = ?')
    .get(result.taskId) as { context_json: string }
  const snapshot = JSON.parse(raw.context_json) as {
    included: Array<{ id: string; title: string }>
    relations: unknown[]
  }
  expect(snapshot.included.map((item) => item.id)).toEqual(['text-1'])
  expect(snapshot.included[0]?.title).toBe('登录页需求')
  expect(snapshot.relations).toEqual([])
})
```

`apps/daemon/test/rest-api.test.ts` 新增：详情返回 `context: null`（旧任务）与写入后的快照；坏 JSON 降级为 `null`；`GET /api/tasks` 的响应项不含 `context` 字段。

```ts
it('keeps the task list free of context snapshots', async () => {
  // seed 一个带 context_json 的任务
  const response = await app.inject({
    method: 'GET',
    url: '/api/tasks?workspaceId=w1',
  })
  const body = response.json() as { tasks: Array<Record<string, unknown>> }
  expect(body.tasks[0]).not.toHaveProperty('context')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- task-service rest-api`
Expected: FAIL，`context_json` 未写入 / 响应无 `context`。

- [ ] **Step 3: 改 repository**

```ts
export function insertTask(tx: Tx, input: Task, contextJson: string | null = null): void {
  tx.insert(task)
    .values({
      // ...现有字段
      contextJson,
    })
    .run()
}

export function getTaskDetail(
  db: Db,
  id: string,
): { task: TaskDetail; contextInvalid: boolean } | null {
  const row = db.select().from(task).where(eq(task.id, id)).get()
  if (!row) return null
  const base = toTask(row)
  if (!row.contextJson) {
    return { task: TaskDetail.parse({ ...base, context: null }), contextInvalid: false }
  }
  try {
    const parsed = ContextSnapshot.safeParse(JSON.parse(row.contextJson) as unknown)
    if (!parsed.success) {
      return { task: TaskDetail.parse({ ...base, context: null }), contextInvalid: true }
    }
    return { task: TaskDetail.parse({ ...base, context: parsed.data }), contextInvalid: false }
  } catch {
    return { task: TaskDetail.parse({ ...base, context: null }), contextInvalid: true }
  }
}
```

- [ ] **Step 4: task-service 写快照**

```ts
const snapshot = {
  included: assembled.included,
  dropped: assembled.dropped,
  truncated: assembled.truncated,
  redactedPaths: assembled.redactedPaths,
  relations: assembled.relations,
  relationsTruncated: assembled.relationsTruncated,
}

deps.db.transaction((tx) => {
  insertTask(tx, { /* ...现有字段 */ }, JSON.stringify(snapshot))
  // audit 不变
})
```

- [ ] **Step 5: HTTP 详情与日志**

`apps/daemon/src/http/tasks.ts`：

```ts
export function registerTaskRoutes(
  app: FastifyInstance,
  deps: { db: Db; logger: Logger },
): void {
  // ...
  const detail = getTaskDetail(deps.db, params.id)
  if (!detail) {
    throw appError('task_not_found', 'task not found', { taskId: params.id })
  }
  if (detail.contextInvalid) {
    deps.logger.error(
      { event: 'context_snapshot_invalid', taskId: params.id },
      'context snapshot invalid',
    )
  }
  return TaskDetailResponse.parse({
    task: detail.task,
    sessions: listSessionsByTask(deps.db, detail.task.id),
    approvals: listApprovalsByTask(deps.db, detail.task.id),
    review: getReviewByTask(deps.db, detail.task.id),
    waitingSince: waitingSinceFor(detail.task),
    attention: attentionFor(detail.task.status, detail.task.waitingReason),
  })
}
```

`apps/daemon/src/app.ts`：`registerTaskRoutes(app, { db: deps.db, logger: deps.logger })`。

- [ ] **Step 6: 跑测试**

Run: `pnpm --filter @evanfang0054/baton test -- task-service rest-api`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/daemon/src/db/repositories.ts apps/daemon/src/runtime/task-service.ts apps/daemon/src/http/tasks.ts apps/daemon/src/app.ts apps/daemon/test/task-service.test.ts apps/daemon/test/rest-api.test.ts
git commit -m "feat(daemon): 任务上下文快照持久化与详情返回"
```

---

## Task 6: 删节点级联删边

Blocking: Task 4
Slice type: tracer-bullet
Seam: `node.delete` 行为

**Files:**

- Modify: `apps/daemon/src/runtime/index.ts`
- Modify: `apps/daemon/test/ws-router.test.ts`
- Modify: `apps/daemon/test/repositories.test.ts`

- [ ] **Step 1: 改失败测试**

`apps/daemon/test/ws-router.test.ts` 现有「被边引用返回 `node_in_use`」用例改为：

```ts
it('deletes a node together with its edges', async () => {
  // seed: text-1 --e1--> agent node
  await client.send({ type: 'edge.create', payload: { sourceId: 'text-1', targetId: seeded.nodeId } })
  const deleted = await client.send({ type: 'node.delete', payload: { nodeId: 'text-1' } })
  expect(deleted.ok).toBe(true)
  expect(
    database.raw.prepare('select count(*) as count from edge where source_id = ?').get('text-1'),
  ).toEqual({ count: 0 })
})
```

保留「被任务引用 → `node_in_use / task`」用例。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- ws-router`
Expected: FAIL，仍返回 `node_in_use / edge`。

- [ ] **Step 3: 改命令处理**

`apps/daemon/src/runtime/index.ts` 的 `node.delete`：

- 删除 `hasEdgeForNode` 判断与 import。
- 从 `../db/repositories.js` 导入 `deleteEdgesForNode`。
- 事务改为：

```ts
deps.db.transaction((tx) => {
  deleteEdgesForNode(tx, existing.id)
  deleteNode(tx, existing.id)
})
```

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton test -- ws-router repositories`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/runtime/index.ts apps/daemon/test/ws-router.test.ts apps/daemon/test/repositories.test.ts
git commit -m "feat(daemon): 删节点级联清理边"
```

---

## Task 7: 后端全量验证与文档收口

Blocking: Task 1-6
Slice type: verification
Seam: `pnpm verify`

- [ ] **Step 1: 跑定向测试**

```bash
pnpm --filter @baton/protocol test
pnpm --filter @baton/core test
pnpm --filter @evanfang0054/baton test
```

Expected: 全绿。

- [ ] **Step 2: 跑全量**

```bash
pnpm verify
```

Expected: typecheck、lint、format、boundaries、protocol 检查、测试、build 全绿。

- [ ] **Step 3: 更新文档索引**

确认 `docs/README.md` 已列 spec 与 contract；在 `docs/plans/2026-11-18-m1-6b-context-core.md` 末尾追加完成记录（日期、commit、`pnpm verify` 结果）。

- [ ] **Step 4: 提交**

```bash
git add docs/plans/2026-11-18-m1-6b-context-core.md
git commit -m "docs(plan): M1-6b 后端计划完成记录"
```
