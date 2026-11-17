---
spec_ref: ../specs/2026-11-17-m1-web-console-design.md
spec_topic: m1-web-console
task_count: 5
estimated_phases: [tests, implementation, verification]
dod: "Plan 1 交付 contract DoD 7/8/11：TaskSummary、session events 历史、node CRUD；为 Plan 2-4 提供稳定 REST/WS 契约"
depends_on: null
---

# M1-6a 契约层实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use agent-harness:subagent-driven-development (recommended) or agent-harness:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 M1-6a web 控制台补齐 protocol/daemon 契约：`TaskSummary`、session events 历史、`node.create/update/delete`。

**Architecture:** 先改 `packages/protocol` 的 zod schema 与 WS 命令联合；再在 daemon 补 repository、REST 路由与 WS dispatch。web 不参与本 plan；Plan 2-4 只消费这里定义的契约。

**Tech Stack:** TypeScript ESM、zod 4、Drizzle ORM + better-sqlite3、Fastify 5、`ws`、vitest。

**GDD note:** 本项目在 M1 显式跳过 GDD，测试设计由 `docs/contracts/M1-web-console.contract.md` 的 18 条 DoD 承担。本 plan 覆盖其中 DoD 7、8、11，并为 DoD 17 提供契约层测试。

**Design sync:** `attention` / `waitingSince` 是 `DESIGN.md` §7.2 看板 7 列与等待时长的数据来源；`text/file/agent` 是 §7.3 画布节点类型。Plan 1 只定义契约，不做视觉实现。

**Sprint contract:** `docs/contracts/M1-web-console.contract.md`。本 plan 的每个 Task 必须能回溯到至少一条 DoD。

**Commit strategy:** 每个 Task 结尾提交；用户已选择 per-task commit。

---

## Task 1: Protocol — TaskSummary、session events、node 命令

Blocking: none
Slice type: tracer-bullet
Seam: zod schema round-trip tests

**Files:**
- Modify: `packages/protocol/src/api.ts`
- Modify: `packages/protocol/src/commands.ts`
- Test: `packages/protocol/test/api.test.ts`
- Test: `packages/protocol/test/commands.test.ts`

**Interfaces:**
- Produces: `TaskSummary`, `TaskListResponse`（`TaskSummary[]`）
- Produces: `SessionEventsQuery`, `SessionEventsResponse`
- Produces: `NodeCreateValue`, `NodeCreateInput`, `NodeUpdateInput`, `NodeDeleteInput`
- Produces: `ClientMessage` 增加 `node.create/update/delete`
- Consumes: `Task`、`Attention`、`Timestamp`、`Id`、`Engine`、`Node` 的数据形状

- [x] **Step 1: 写失败测试（api）**

在 `packages/protocol/test/api.test.ts` 顶部 imports 增加：

```ts
import {
  SessionEventsQuery,
  SessionEventsResponse,
  TaskSummary,
} from '../src/api.js'
```

把现有 `const task = {...}` 改为带 `attention/waitingSince` 的 summary fixture：

```ts
const task = {
  id: 't1',
  workspaceId: 'w1',
  nodeId: null,
  title: 'demo',
  prompt: '<task>demo</task>',
  status: 'todo',
  waitingReason: null,
  engine: 'fake',
  workspaceMode: 'main',
  branch: null,
  worktreePath: null,
  verifyCommand: null,
  retryCount: 0,
  createdAt: 1,
  updatedAt: 1,
  attention: 'none',
  waitingSince: null,
}
```

在 `describe('REST DTO schemas', ...)` 内增加：

```ts
it('validates task summary attention and waitingSince', () => {
  expect(TaskSummary.parse(task).attention).toBe('none')
  expect(TaskListResponse.parse({ tasks: [task] }).tasks[0]?.waitingSince).toBeNull()
  expect(() =>
    TaskListResponse.parse({ tasks: [{ ...task, attention: 'paused' }] }),
  ).toThrow()
})

it('validates session events query and response', () => {
  expect(SessionEventsQuery.parse({}).sinceSeq).toBe(0)
  expect(SessionEventsQuery.parse({ sinceSeq: '2', limit: '10' })).toMatchObject({
    sinceSeq: 2,
    limit: 10,
  })
  expect(() => SessionEventsQuery.parse({ limit: 0 })).toThrow()
  expect(() => SessionEventsQuery.parse({ limit: 1001 })).toThrow()

  const response = {
    sessionId: 's1',
    events: [{ seq: 1, type: 'RUN_STARTED', payload: {}, ts: 1 }],
    nextSeq: 1,
    hasMore: false,
  }
  expect(SessionEventsResponse.parse(response).events).toHaveLength(1)
})
```

- [x] **Step 2: 写失败测试（commands）**

在 `packages/protocol/test/commands.test.ts` 的 `fixtures` 数组增加：

```ts
[
  'node.create',
  {
    canvasId: 'c1',
    node: {
      type: 'text',
      x: 0,
      y: 0,
      w: 320,
      h: 200,
      groupId: null,
      data: { content: 'hello' },
    },
  },
],
['node.update', { nodeId: 'n1', patch: { x: 10, y: 20 } }],
['node.delete', { nodeId: 'n1' }],
```

在 `describe('ClientMessage', ...)` 内增加：

```ts
it('accepts unsupported node types at schema level for handler rejection', () => {
  const parsed = ClientMessage.parse({
    v: 1,
    id: 'c1',
    ts: 1,
    type: 'node.create',
    payload: {
      canvasId: 'c1',
      node: {
        type: 'image',
        x: 0,
        y: 0,
        w: 320,
        h: 200,
        groupId: null,
        data: { src: 'https://example.com/a.png' },
      },
    },
  })
  expect(parsed.type).toBe('node.create')
})

it('rejects node.update without nodeId', () => {
  expect(() =>
    ClientMessage.parse({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'node.update',
      payload: { patch: { x: 1 } },
    }),
  ).toThrow()
})
```

- [x] **Step 3: 运行测试确认失败**

```bash
pnpm --filter @baton/protocol test -- api.test.ts commands.test.ts
```

Expected: FAIL，`TaskSummary`/`SessionEventsQuery`/`SessionEventsResponse` 未导出，`node.create` 不在 union。

- [x] **Step 4: 实现 `TaskSummary` 与 session events schema**

在 `packages/protocol/src/api.ts`：

```ts
import { Attention } from './enums.js' // 加到现有 imports
```

在 `TaskListResponse` 前增加：

```ts
export const TaskSummary = Task.extend({
  attention: Attention,
  waitingSince: Timestamp.nullable(),
})
export type TaskSummary = z.infer<typeof TaskSummary>

export const TaskListResponse = z.object({ tasks: z.array(TaskSummary) })
export type TaskListResponse = z.infer<typeof TaskListResponse>

export const SessionEventsQuery = z.object({
  sinceSeq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
})
export type SessionEventsQuery = z.infer<typeof SessionEventsQuery>

export const SessionEventRecord = z.object({
  seq: z.number().int().nonnegative(),
  type: z.string().min(1),
  payload: z.unknown(),
  ts: Timestamp,
})
export type SessionEventRecord = z.infer<typeof SessionEventRecord>

export const SessionEventsResponse = z.object({
  sessionId: Id,
  events: z.array(SessionEventRecord),
  nextSeq: z.number().int().nonnegative(),
  hasMore: z.boolean(),
})
export type SessionEventsResponse = z.infer<typeof SessionEventsResponse>
```

删除旧的 `TaskListResponse = z.object({ tasks: z.array(Task) })` 行。

- [x] **Step 5: 实现 node 命令 schema**

在 `packages/protocol/src/commands.ts` 的 `ReviewDecideInput` 后增加：

```ts
const NodeCreateBase = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive().default(320),
  h: z.number().positive().default(200),
  groupId: Id.nullable().default(null),
})

export const NodeCreateValue = z.discriminatedUnion('type', [
  NodeCreateBase.extend({
    type: z.literal('text'),
    data: z.object({ content: z.string() }),
  }),
  NodeCreateBase.extend({
    type: z.literal('image'),
    data: z.object({ src: z.string().min(1), alt: z.string().optional() }),
  }),
  NodeCreateBase.extend({
    type: z.literal('file'),
    data: z.object({
      path: z.string().min(1),
      name: z.string().min(1),
      mime: z.string().min(1).optional(),
    }),
  }),
  NodeCreateBase.extend({
    type: z.literal('agent'),
    data: z.object({
      title: z.string().min(1),
      engine: Engine,
      taskId: Id.nullable().default(null),
    }),
  }),
  NodeCreateBase.extend({
    type: z.literal('review'),
    data: z.object({ taskId: Id }),
  }),
  NodeCreateBase.extend({
    type: z.literal('group'),
    data: z.object({
      label: z.string().min(1),
      color: z.string().min(1).optional(),
      collapsed: z.boolean().default(false),
    }),
  }),
])
export type NodeCreateValue = z.infer<typeof NodeCreateValue>

export const NodeCreateInput = z.object({
  canvasId: Id,
  node: NodeCreateValue,
})
export type NodeCreateInput = z.infer<typeof NodeCreateInput>

export const NodeUpdateInput = z.object({
  nodeId: Id,
  patch: z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().positive().optional(),
    h: z.number().positive().optional(),
    data: z.unknown().optional(),
  }),
})
export type NodeUpdateInput = z.infer<typeof NodeUpdateInput>

export const NodeDeleteInput = z.object({ nodeId: Id })
export type NodeDeleteInput = z.infer<typeof NodeDeleteInput>
```

在 `ClientMessage` union 增加：

```ts
CommandBase.extend({ type: z.literal('node.create'), payload: NodeCreateInput }),
CommandBase.extend({ type: z.literal('node.update'), payload: NodeUpdateInput }),
CommandBase.extend({ type: z.literal('node.delete'), payload: NodeDeleteInput }),
```

- [x] **Step 6: 运行测试确认通过**

```bash
pnpm --filter @baton/protocol test -- api.test.ts commands.test.ts
```

Expected: PASS。

- [x] **Step 7: 提交**

```bash
git add packages/protocol/src/api.ts packages/protocol/src/commands.ts packages/protocol/test/api.test.ts packages/protocol/test/commands.test.ts
git commit -m "feat(protocol): 增加 TaskSummary、session events 与 node 命令契约"
```

---

## Task 2: Daemon repository — session events 与 node CRUD

Blocking: Task 1
Slice type: tracer-bullet
Seam: `apps/daemon/test/repositories.test.ts`

**Files:**
- Modify: `apps/daemon/src/db/repositories.ts`
- Test: `apps/daemon/test/repositories.test.ts`

**Interfaces:**
- Consumes: `Node`（Task 1 的 schema 形状不变）
- Produces: `getCanvas(db, id)`, `getNode(db, id)`, `insertNode(tx, node)`, `updateNode(tx, id, patch)`, `deleteNode(tx, id)`, `hasTaskForNode(db, nodeId)`
- Produces: `listSessionEvents(db, sessionId, sinceSeq, limit) => { rows, hasMore }`

- [x] **Step 1: 写失败测试（node CRUD + session events）**

在 `apps/daemon/test/repositories.test.ts` 顶部 imports 增加：

```ts
import { Node } from '@baton/protocol'
```

在 `describe('repositories', ...)` 内增加：

```ts
it('creates, updates and deletes text nodes', () => {
  const database = db()
  const seeded = seedTask(database.raw)
  const created = Node.parse({
    id: 'text-2',
    canvasId: seeded.canvasId,
    type: 'text',
    x: 1,
    y: 2,
    w: 320,
    h: 200,
    groupId: null,
    data: { content: 'hello' },
    createdAt: 1,
    updatedAt: 1,
  })

  database.db.transaction((tx) => repo.insertNode(tx, created))
  expect(repo.getNode(database.db, 'text-2')?.type).toBe('text')

  database.db.transaction((tx) =>
    repo.updateNode(tx, 'text-2', {
      x: 50,
      y: 60,
      data: { content: 'updated' },
      updatedAt: 2,
    }),
  )
  expect(repo.getNode(database.db, 'text-2')).toMatchObject({
    x: 50,
    y: 60,
    data: { content: 'updated' },
  })

  database.db.transaction((tx) => repo.deleteNode(tx, 'text-2'))
  expect(repo.getNode(database.db, 'text-2')).toBeNull()
})

it('detects tasks referencing a node', () => {
  const database = db()
  const seeded = seedTask(database.raw)
  expect(repo.hasTaskForNode(database.db, seeded.nodeId)).toBe(true)
  expect(repo.hasTaskForNode(database.db, 'missing')).toBe(false)
})

it('lists session events with pagination', () => {
  const database = db()
  const seeded = seedTask(database.raw)
  if (!seeded.sessionId) throw new Error('expected session')

  database.raw
    .prepare(
      `insert into event (id, session_id, ordinal, seq, type, payload_json, ts)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('e1', seeded.sessionId, 1, 1, 'RUN_STARTED', JSON.stringify({ type: 'RUN_STARTED' }), 1)
  database.raw
    .prepare(
      `insert into event (id, session_id, ordinal, seq, type, payload_json, ts)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('e2', seeded.sessionId, 2, 2, 'RUN_FINISHED', JSON.stringify({ type: 'RUN_FINISHED' }), 2)

  const first = repo.listSessionEvents(database.db, seeded.sessionId, 0, 1)
  expect(first.rows).toHaveLength(1)
  expect(first.rows[0]?.seq).toBe(1)
  expect(first.hasMore).toBe(true)

  const second = repo.listSessionEvents(database.db, seeded.sessionId, 1, 10)
  expect(second.rows.map((row) => row.seq)).toEqual([2])
  expect(second.hasMore).toBe(false)
})
```

- [x] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @evanfang0054/baton test -- repositories.test.ts
```

Expected: FAIL，`insertNode` / `getNode` / `updateNode` / `deleteNode` / `hasTaskForNode` / `listSessionEvents` 未导出。

- [x] **Step 3: 实现 node repository**

在 `apps/daemon/src/db/repositories.ts` 的 `listNodes` 后增加：

```ts
export function getCanvas(db: Db, id: string): Canvas | null {
  const row = db.select().from(canvas).where(eq(canvas.id, id)).get()
  return row ? toCanvas(row) : null
}

export function getNode(db: Db, id: string): Node | null {
  const row = db.select().from(node).where(eq(node.id, id)).get()
  return row ? toNode(row) : null
}

export function insertNode(tx: Tx, input: Node): void {
  tx.insert(node)
    .values({
      id: input.id,
      canvasId: input.canvasId,
      type: input.type,
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      groupId: input.groupId,
      dataJson: JSON.stringify(input.data),
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .run()
}

export function updateNode(
  tx: Tx,
  id: string,
  patch: {
    x?: number
    y?: number
    w?: number
    h?: number
    data?: unknown
    updatedAt: number
  },
): void {
  const set: Partial<typeof node.$inferInsert> = { updatedAt: patch.updatedAt }
  if (patch.x !== undefined) set.x = patch.x
  if (patch.y !== undefined) set.y = patch.y
  if (patch.w !== undefined) set.w = patch.w
  if (patch.h !== undefined) set.h = patch.h
  if (patch.data !== undefined) set.dataJson = JSON.stringify(patch.data)
  tx.update(node).set(set).where(eq(node.id, id)).run()
}

export function deleteNode(tx: Tx, id: string): void {
  tx.delete(node).where(eq(node.id, id)).run()
}

export function hasTaskForNode(db: Db, nodeId: string): boolean {
  return (
    db.select({ id: task.id }).from(task).where(eq(task.nodeId, nodeId)).limit(1).get() !==
    undefined
  )
}
```

- [x] **Step 4: 实现 `listSessionEvents`**

在 `repositories.ts` 顶部 schema import 增加 `event`：

```ts
import { approval, audit, canvas, edge, event, node, review, session, task, workspace } from './schema.js'
```

在 `hasTaskForNode` 后增加：

```ts
export interface SessionEventRecord {
  seq: number
  type: string
  payload: unknown
  ts: number
}

export function listSessionEvents(
  db: Db,
  sessionId: string,
  sinceSeq: number,
  limit: number,
): { rows: SessionEventRecord[]; hasMore: boolean } {
  const rows = db
    .select()
    .from(event)
    .where(and(eq(event.sessionId, sessionId), gt(event.seq, sinceSeq)))
    .orderBy(asc(event.seq))
    .limit(limit + 1)
    .all()

  return {
    rows: rows.slice(0, limit).map((row) => ({
      seq: row.seq,
      type: row.type,
      payload: JSON.parse(row.payloadJson) as unknown,
      ts: row.ts,
    })),
    hasMore: rows.length > limit,
  }
}
```

> `gt` 需要加到现有 drizzle imports：`import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm'`。

- [x] **Step 5: 运行测试确认通过**

```bash
pnpm --filter @evanfang0054/baton test -- repositories.test.ts
```

Expected: PASS。

- [x] **Step 6: 提交**

```bash
git add apps/daemon/src/db/repositories.ts apps/daemon/test/repositories.test.ts
git commit -m "feat(daemon): 增加 node CRUD 与 session events repository"
```

---

## Task 3: REST — TaskSummary 与 session events 路由

Blocking: Task 1, Task 2
Slice type: tracer-bullet
Seam: `apps/daemon/test/rest-api.test.ts`

**Files:**
- Modify: `apps/daemon/src/http/tasks.ts`
- Create: `apps/daemon/src/http/sessions.ts`
- Modify: `apps/daemon/src/app.ts`
- Test: `apps/daemon/test/rest-api.test.ts`

**Interfaces:**
- Consumes: `TaskSummary`、`SessionEventsQuery`、`SessionEventsResponse`（Task 1）
- Consumes: `listSessionEvents`（Task 2）
- Produces: `GET /api/tasks` 返回 `TaskSummary[]`
- Produces: `GET /api/sessions/:id/events`

- [x] **Step 1: 写失败测试（tasks list + session events）**

在 `apps/daemon/test/rest-api.test.ts` 的 `it('reads canvas, tasks and task detail', ...)` 内，`tasks` 响应断言改为：

```ts
const taskList = tasks.json() as {
  tasks: Array<{ attention: string; waitingSince: number | null }>
}
expect(taskList.tasks[0]?.attention).toBe('none')
expect(taskList.tasks[0]?.waitingSince).toBeNull()
```

在同一测试的 `waiting` 状态更新后，重新请求 tasks 并断言：

```ts
const waitingTasks = await app.inject({
  method: 'GET',
  url: `/api/tasks?workspaceId=${handle.seeded.workspaceId}`,
  headers: auth,
})
const waitingBody = waitingTasks.json() as {
  tasks: Array<{ attention: string; waitingSince: number | null }>
}
expect(waitingBody.tasks[0]?.attention).toBe('needs_reply')
expect(waitingBody.tasks[0]?.waitingSince).toBe(42)
```

新增测试：

```ts
it('returns session events history', async () => {
  const { app, handle } = await setup()
  if (!handle.seeded.sessionId) throw new Error('expected session')
  handle.database.raw
    .prepare(
      `insert into event (id, session_id, ordinal, seq, type, payload_json, ts)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'event-1',
      handle.seeded.sessionId,
      1,
      1,
      'RUN_STARTED',
      JSON.stringify({ type: 'RUN_STARTED' }),
      1,
    )

  const response = await app.inject({
    method: 'GET',
    url: `/api/sessions/${handle.seeded.sessionId}/events?sinceSeq=0&limit=10`,
    headers: auth,
  })
  expect(response.statusCode).toBe(200)
  const body = response.json() as {
    events: Array<{ seq: number; type: string }>
    hasMore: boolean
  }
  expect(body.events).toEqual([{ seq: 1, type: 'RUN_STARTED', payload: { type: 'RUN_STARTED' }, ts: 1 }])
  expect(body.hasMore).toBe(false)

  const missing = await app.inject({
    method: 'GET',
    url: '/api/sessions/missing/events',
    headers: auth,
  })
  expect(missing.statusCode).toBe(404)

  const invalid = await app.inject({
    method: 'GET',
    url: `/api/sessions/${handle.seeded.sessionId}/events?limit=0`,
    headers: auth,
  })
  expect(invalid.statusCode).toBe(400)
})
```

- [x] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @evanfang0054/baton test -- rest-api.test.ts
```

Expected: FAIL，tasks 没有 `attention/waitingSince`，`/api/sessions/:id/events` 404。

- [x] **Step 3: 改 tasks 路由**

在 `apps/daemon/src/http/tasks.ts` 顶部增加：

```ts
import { attentionFor } from '@baton/core'
```

把 `GET /api/tasks` 的 return 改为：

```ts
const tasks = listTasks(deps.db, parsed.data).map((task) => ({
  ...task,
  attention: attentionFor(task.status, task.waitingReason),
  waitingSince:
    task.status === 'waiting_input' || task.status === 'review' ? task.updatedAt : null,
}))
return TaskListResponse.parse({ tasks })
```

- [x] **Step 4: 新增 sessions 路由**

创建 `apps/daemon/src/http/sessions.ts`：

```ts
import { SessionEventsQuery, SessionEventsResponse } from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import { getSession, listSessionEvents } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'

export function registerSessionRoutes(app: FastifyInstance, deps: { db: Db }): void {
  app.get('/api/sessions/:id/events', async (req) => {
    const params = req.params as { id?: string }
    if (!params.id) {
      throw appError('invalid_payload', 'session id is required')
    }
    const parsed = SessionEventsQuery.safeParse(req.query)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid session events query', parsed.error.issues)
    }
    const session = getSession(deps.db, params.id)
    if (!session) {
      throw appError('session_not_found', 'session not found', { sessionId: params.id })
    }
    const result = listSessionEvents(deps.db, params.id, parsed.data.sinceSeq, parsed.data.limit)
    const nextSeq = result.rows.at(-1)?.seq ?? parsed.data.sinceSeq
    return SessionEventsResponse.parse({
      sessionId: params.id,
      events: result.rows,
      nextSeq,
      hasMore: result.hasMore,
    })
  })
}
```

- [x] **Step 5: 注册路由**

在 `apps/daemon/src/app.ts` 顶部增加：

```ts
import { registerSessionRoutes } from './http/sessions.js'
```

在 `registerTaskRoutes(app, { db: deps.db })` 后增加：

```ts
registerSessionRoutes(app, { db: deps.db })
```

- [x] **Step 6: 运行测试确认通过**

```bash
pnpm --filter @evanfang0054/baton test -- rest-api.test.ts
```

Expected: PASS。

- [x] **Step 7: 提交**

```bash
git add apps/daemon/src/http/tasks.ts apps/daemon/src/http/sessions.ts apps/daemon/src/app.ts apps/daemon/test/rest-api.test.ts
git commit -m "feat(daemon): 增加 TaskSummary 与 session events REST"
```

---

## Task 4: WS — node.create/update/delete

Blocking: Task 1, Task 2
Slice type: tracer-bullet
Seam: `apps/daemon/test/ws-router.test.ts`

**Files:**
- Modify: `apps/daemon/src/runtime/index.ts`
- Test: `apps/daemon/test/ws-router.test.ts`

**Interfaces:**
- Consumes: `NodeCreateInput`、`NodeUpdateInput`、`NodeDeleteInput`（Task 1）
- Consumes: `getCanvas`、`getNode`、`insertNode`、`updateNode`、`deleteNode`、`hasTaskForNode`（Task 2）
- Produces: WS `node.create/update/delete` 命令与 `ack.data = { nodeId }`

- [x] **Step 1: 写失败测试**

在 `apps/daemon/test/ws-router.test.ts` 内增加：

```ts
it('creates, updates and deletes text nodes', async () => {
  const { handle, ws } = await setup()

  ws.send({
    v: 1,
    type: 'node.create',
    id: 'n1',
    ts: 1,
    payload: {
      canvasId: handle.seeded.canvasId,
      node: {
        type: 'text',
        x: 1,
        y: 2,
        w: 320,
        h: 200,
        groupId: null,
        data: { content: 'hello' },
      },
    },
  })
  const created = await ws.next('ack')
  const nodeId = (created.payload as { data: { nodeId: string } }).data.nodeId
  expect(nodeId).toBeTruthy()

  ws.send({
    v: 1,
    type: 'node.update',
    id: 'n2',
    ts: 1,
    payload: { nodeId, patch: { x: 50, y: 60, data: { content: 'updated' } } },
  })
  await ws.next('ack')

  ws.send({ v: 1, type: 'node.delete', id: 'n3', ts: 1, payload: { nodeId } })
  await ws.next('ack')
})

it('rejects deleting a node referenced by a task', async () => {
  const { handle, ws } = await setup()
  ws.send({
    v: 1,
    type: 'node.delete',
    id: 'n1',
    ts: 1,
    payload: { nodeId: handle.seeded.nodeId },
  })
  const error = await ws.next('error')
  expect(error.payload).toMatchObject({ code: 'node_in_use' })
})

it('rejects unsupported node types in 6a', async () => {
  const { handle, ws } = await setup()
  ws.send({
    v: 1,
    type: 'node.create',
    id: 'n1',
    ts: 1,
    payload: {
      canvasId: handle.seeded.canvasId,
      node: {
        type: 'image',
        x: 0,
        y: 0,
        w: 320,
        h: 200,
        groupId: null,
        data: { src: 'https://example.com/a.png' },
      },
    },
  })
  const error = await ws.next('error')
  expect(error.payload).toMatchObject({ code: 'unsupported_node_type' })
})
```

- [x] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @evanfang0054/baton test -- ws-router.test.ts
```

Expected: FAIL，`node.create` 命令未处理，返回 `invalid_payload`。

- [x] **Step 3: 增加 runtime imports**

在 `apps/daemon/src/runtime/index.ts` 顶部：

```ts
import { Node } from '@baton/protocol'
import type {
  AppError,
  ApprovalDecideInput,
  ClientMessage,
  ReviewDecideInput,
  TaskTransitionEvent,
} from '@baton/protocol'
```

在 repository imports 增加：

```ts
import {
  getCanvas,
  getNode,
  hasTaskForNode,
  insertNode,
  updateNode,
  deleteNode,
  // ...existing imports
} from '../db/repositories.js'
```

- [x] **Step 4: 实现 node 命令分支**

在 `handleCommand` 的 `case 'resume'` 前增加：

```ts
case 'node.create': {
  const canvas = getCanvas(deps.db, message.payload.canvasId)
  if (!canvas) {
    return {
      ok: false,
      error: appError('canvas_not_found', 'canvas not found', {
        canvasId: message.payload.canvasId,
      }),
    }
  }
  const input = message.payload.node
  if (input.type !== 'text' && input.type !== 'file' && input.type !== 'agent') {
    return {
      ok: false,
      error: appError('unsupported_node_type', 'node type is not supported in M1-6a', {
        type: input.type,
      }),
    }
  }
  const id = newId()
  const ts = now()
  let created: Node
  try {
    created = Node.parse({
      id,
      canvasId: canvas.id,
      ...input,
      createdAt: ts,
      updatedAt: ts,
    })
  } catch {
    return { ok: false, error: appError('invalid_payload', 'invalid node payload') }
  }
  deps.db.transaction((tx) => insertNode(tx, created))
  return { ok: true, ack: { nodeId: id } }
}
case 'node.update': {
  const existing = getNode(deps.db, message.payload.nodeId)
  if (!existing) {
    return {
      ok: false,
      error: appError('node_not_found', 'node not found', {
        nodeId: message.payload.nodeId,
      }),
    }
  }
  const patch = message.payload.patch
  if (patch.data !== undefined) {
    if (typeof patch.data !== 'object' || patch.data === null || Array.isArray(patch.data)) {
      return { ok: false, error: appError('invalid_payload', 'node data must be an object') }
    }
    if (existing.type === 'file') {
      return { ok: false, error: appError('invalid_payload', 'file node data is immutable') }
    }
    if (existing.type === 'text') {
      const data = patch.data as { content?: unknown }
      if (typeof data.content !== 'string' || Object.keys(data).length !== 1) {
        return { ok: false, error: appError('invalid_payload', 'text node data must be { content }') }
      }
    }
    if (existing.type === 'agent') {
      const data = patch.data as { title?: unknown }
      if (typeof data.title !== 'string' || Object.keys(data).length !== 1) {
        return { ok: false, error: appError('invalid_payload', 'agent node data must be { title }') }
      }
    }
  }
  let next: Node
  try {
    next = Node.parse({
      ...existing,
      x: patch.x ?? existing.x,
      y: patch.y ?? existing.y,
      w: patch.w ?? existing.w,
      h: patch.h ?? existing.h,
      data: patch.data ?? existing.data,
      updatedAt: now(),
    })
  } catch {
    return { ok: false, error: appError('invalid_payload', 'invalid node patch') }
  }
  deps.db.transaction((tx) =>
    updateNode(tx, existing.id, {
      x: next.x,
      y: next.y,
      w: next.w,
      h: next.h,
      data: next.data,
      updatedAt: next.updatedAt,
    }),
  )
  return { ok: true, ack: { nodeId: existing.id } }
}
case 'node.delete': {
  const existing = getNode(deps.db, message.payload.nodeId)
  if (!existing) {
    return {
      ok: false,
      error: appError('node_not_found', 'node not found', {
        nodeId: message.payload.nodeId,
      }),
    }
  }
  if (hasTaskForNode(deps.db, existing.id)) {
    return {
      ok: false,
      error: appError('node_in_use', 'node is referenced by a task', {
        nodeId: existing.id,
      }),
    }
  }
  deps.db.transaction((tx) => deleteNode(tx, existing.id))
  return { ok: true, ack: { nodeId: existing.id } }
}
```

- [x] **Step 5: 运行测试确认通过**

```bash
pnpm --filter @evanfang0054/baton test -- ws-router.test.ts
```

Expected: PASS。

- [x] **Step 6: 提交**

```bash
git add apps/daemon/src/runtime/index.ts apps/daemon/test/ws-router.test.ts
git commit -m "feat(daemon): 增加 node.create/update/delete WS 命令"
```

---

## Task 5: 全量验证

Blocking: Task 1-4
Slice type: verification
Seam: 全量命令

**Files:**
- Verify: `packages/protocol`, `apps/daemon`

- [x] **Step 1: 跑 protocol/daemon 测试**

```bash
pnpm --filter @baton/protocol test
pnpm --filter @evanfang0054/baton test
```

Expected: PASS；新增测试全部通过，旧测试不回归。

- [x] **Step 2: 跑全量质量门**

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
```

Expected: 全部 exit 0。

- [x] **Step 3: 检查范围**

```bash
git diff --name-only main...HEAD
```

Expected: 只包含 `packages/protocol/**`、`apps/daemon/**`、`docs/**`；没有 `apps/web` 改动，没有 `packages/core` 语义改动。

- [x] **Step 4: 记录结果**

在 PR 或任务记录里贴真实命令输出；如果任一命令失败，先修复再继续。本 Task 不改代码，因此不产生 commit。

---

## 执行记录

| 日期 | Task | 结果 | Commit | 备注 |
|---|---|---|---|---|
| 2026-11-17 | Task 1-4 | protocol 97 tests、daemon 110 tests；`pnpm typecheck`、`pnpm verify`、`pnpm verify:full`、`pnpm pack:check` 全绿 | `33e9497` | Task 1 单独提交无法通过 `pnpm verify`（daemon 穷尽性错误 + tasks route 旧形状），经用户确认合并为一个契约 slice；同时补了 Task 3 的 sessions route 与 `tasks.ts` summary 映射 |
| 2026-11-17 | Task 5 | `pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`check:boundaries`、`check:protocol`、`format:check` 全绿；`apps/web` 无代码改动 | 见上 | 只改 protocol/daemon/docs；未改 core 状态机语义 |

**已记录偏离**：

- 原计划按 Task 逐个提交；但 `ClientMessage` 新增 node 命令会让 daemon `handleCommand` 出现 TS 穷尽性错误，`TaskListResponse` 形状变更会让 `tasks.ts` 运行时 500。经用户确认，Task 1+2+3+4 合并为一个契约 slice commit，避免临时 stub。
- `NodeCreateValue` 在 protocol 层接受全部六种节点，以便 handler 返回 `unsupported_node_type`；6a handler 只处理 text/file/agent。spec §4.3 已同步说明。
- `NodeUpdateInput.patch` 使用 `.strict()`，未知字段在 protocol 层被拒绝；daemon 只允许 text.content / agent.title，file 的 data 不可改。
