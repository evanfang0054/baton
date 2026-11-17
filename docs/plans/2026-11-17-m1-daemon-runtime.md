---
spec_ref: ../specs/2026-11-17-m1-daemon-runtime-design.md
spec_topic: m1-daemon-runtime
task_count: 8
estimated_phases: [tests, implementation, verification]
dod: "M1-5：daemon 运行时闭环（event store、task runner、agent-fake、approval、verify、WS/REST）；apps/web 不动；pnpm verify 全绿"
depends_on: docs/specs/2026-11-17-m1-context-policy-adapter-design.md
---

# M1-5 daemon 运行时闭环实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use agent-harness:subagent-driven-development (recommended) or agent-harness:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不接真实 Claude、不改 web 的前提下，让 daemon 用 `agent-fake` 从 WS 跑通“建任务 → 入队 → 执行 → 审批 → verify → 人工验收”的完整闭环，并支持断线重放。

**Architecture:** 自下而上：protocol 先补 `ack.data`/REST DTO/`maxConcurrency`；daemon 先做 migration 与 event store；再把 workspace/policy/context 的 IO 接到 `task.create`；然后实现两阶段 effect 执行器与调度器；接着接 `agent-fake` 会话与审批；再做 verify 执行器；最后接 WS/REST 并跑端到端验收。

**Tech Stack:** TypeScript strict ESM、pnpm 10、Fastify 5、better-sqlite3 + Drizzle、vitest 5、`@baton/core`、`@baton/adapters`、`execa`、`pino`。

**Scope guard:** 本计划只允许改 `apps/daemon/**`、`packages/protocol/**` 的增量、`docs/**`、`THIRD_PARTY_NOTICES.md`、`pnpm-lock.yaml`。`apps/web/**` 必须为空 diff；`packages/core/**` 与 `packages/adapters/**` 的行为不得改变（只允许类型消费）。

**GDD:** 显式跳过。测试设计由 spec 第 7 节、contract 的 25 条 DoD 与本计划的逐 Task 断言承担。

**Commit strategy:** 每个 Task 结束提交一次；提交前跑该 Task 的定向测试，Task 8 跑全量 `pnpm verify`、`pnpm verify:full`、`pnpm pack:check` 与 `pnpm docker:smoke`。

---

## 文件结构

```text
apps/daemon/
├── migrations/
│   ├── 0001_*.sql                     # 新增：ws_event、event.ordinal、approval.request_id、review nullable
│   └── meta/_journal.json             # 修改
├── src/
│   ├── app.ts                         # 修改：buildApp(config, deps)
│   ├── bootstrap.ts                   # 修改：open DB → migrate → create runtime → reconcile → buildApp
│   ├── start.ts                       # 修改：listen 后 runtime.start()；shutdown 时 runtime.close()
│   ├── config.ts                      # 修改：maxConcurrency
│   ├── log.ts                         # 新增：pino + redact
│   ├── db/
│   │   ├── schema.ts                  # 修改：wsEvent、event.ordinal、approval.requestId、review 可空
│   │   ├── event-store.ts             # 新增：ordinal/seq、append、replay
│   │   └── repositories.ts            # 新增：task/session/approval/review/canvas/node/workspace
│   ├── workspace/
│   │   ├── resolver.ts                # 新增：resolveWithin / readWorkspaceText
│   │   ├── policy.ts                  # 新增：loadPolicy
│   │   └── context.ts                 # 新增：buildContextInput / contentByNodeId
│   ├── runtime/
│   │   ├── types.ts                   # 新增：RuntimeDeps / ActiveRun / TransitionOutcome
│   │   ├── index.ts                   # 新增：createRuntime / handleCommand / start / close
│   │   ├── task-service.ts            # 新增：task.create/enqueue/cancel/review/approval + applyTransition
│   │   ├── effects.ts                 # 新增：两阶段 effect executor
│   │   ├── scheduler.ts               # 新增：pump / kick
│   │   ├── session-runner.ts          # 新增：adapter 事件循环 + approval
│   │   ├── adapter-factory.ts         # 新增：fake / unsupported
│   │   └── boot.ts                    # 新增：重启收敛
│   ├── verify/
│   │   ├── executor.ts                # 新增：resolve + execa + timeout + diff
│   │   ├── output.ts                  # 新增：头尾截断
│   │   └── env.ts                     # 新增：sanitizeEnv
│   ├── ws/
│   │   ├── hub.ts                     # 新增：socket 集合、broadcast、backpressure
│   │   ├── router.ts                  # 新增：ClientMessage dispatch
│   │   └── server.ts                  # 修改：attach hub + router
│   └── http/
│       ├── api-auth.ts                # 新增：/api/* preHandler
│       ├── workspaces.ts              # 新增：GET/POST
│       ├── canvas.ts                  # 新增：GET
│       ├── tasks.ts                   # 新增：GET list/detail
│       └── errors.ts                  # 新增：AppError → HTTP
├── tsup.config.ts                     # 修改：noExternal /^@baton\//
└── test/
    ├── helpers/
    │   ├── db.ts                      # 新增：内存 DB + migration + seed
    │   ├── workspace.ts               # 新增：临时 workspace + git init
    │   ├── ws-client.ts               # 新增：消息队列 helper
    │   └── runtime.ts                 # 新增：createTestRuntime/buildTestApp
    ├── migrate.test.ts                # 修改：表/索引数量、升级
    ├── event-store.test.ts            # 新增
    ├── workspace.test.ts              # 新增
    ├── policy.test.ts                 # 新增
    ├── context-input.test.ts          # 新增
    ├── task-service.test.ts           # 新增
    ├── scheduler.test.ts              # 新增
    ├── session-runner.test.ts         # 新增
    ├── verify-executor.test.ts        # 新增
    ├── ws-router.test.ts              # 新增
    ├── rest-api.test.ts               # 新增
    ├── boot.test.ts                   # 新增
    ├── runtime-e2e.test.ts            # 新增
    └── failure-paths.test.ts          # 新增
```

---

## Task 1: Protocol 增量（ack.data / REST DTO / maxConcurrency）

**Blocking:** none
**Slice type:** tracer-bullet
**Seam:** `import { AckEvent, WorkspaceCreateInput, ConfigSchema } from '@baton/protocol'`

**Files:**
- Modify: `packages/protocol/src/events.ts`
- Create: `packages/protocol/src/api.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/config.ts`
- Test: `packages/protocol/test/events.test.ts`, `packages/protocol/test/api.test.ts`, `packages/protocol/test/foundation.test.ts`

- [ ] **Step 1: 写失败测试**

`events.test.ts` 增加：

```ts
it('accepts ack data and keeps it optional', () => {
  const withData = AckEvent.parse({
    v: 1,
    type: 'ack',
    ts: 1,
    payload: { commandId: 'c1', ok: true, data: { taskId: 't1' } },
  })
  expect(withData.payload.data).toEqual({ taskId: 't1' })

  const withoutData = AckEvent.parse({
    v: 1,
    type: 'ack',
    ts: 1,
    payload: { commandId: 'c1', ok: true },
  })
  expect(withoutData.payload.data).toBeUndefined()
})
```

`api.test.ts` 增加：

```ts
import {
  CanvasResponse,
  TaskDetailResponse,
  TaskListResponse,
  WorkspaceCreateInput,
  WorkspaceCreateResponse,
  WorkspaceListResponse,
} from '../src/index.js'

it('parses workspace create input', () => {
  expect(WorkspaceCreateInput.parse({ name: 'demo', relPath: 'demo' })).toEqual({
    name: 'demo',
    relPath: 'demo',
  })
})

it('exports REST response schemas', () => {
  expect(WorkspaceListResponse).toBeDefined()
  expect(WorkspaceCreateResponse).toBeDefined()
  expect(CanvasResponse).toBeDefined()
  expect(TaskListResponse).toBeDefined()
  expect(TaskDetailResponse).toBeDefined()
})
```

`foundation.test.ts` 增加：

```ts
it('defaults maxConcurrency to 1 and rejects non-positive values', () => {
  const base = {
    host: '127.0.0.1',
    port: 7317,
    token: null,
    dataDir: '/tmp/baton',
    webRoot: '/tmp/web',
    workspacesRoot: '/tmp/ws',
  }
  expect(ConfigSchema.parse(base).maxConcurrency).toBe(1)
  expect(() => ConfigSchema.parse({ ...base, maxConcurrency: 0 })).toThrow()
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @baton/protocol test
```

Expected: `AckEvent` 不接受 `data`，`api.ts` 不存在，`ConfigSchema` 没有 `maxConcurrency`。

- [ ] **Step 3: 实现 `ack.data`**

`packages/protocol/src/events.ts`：

```ts
export const AckEvent = EventBase.extend({
  type: z.literal('ack'),
  seq: z.number().int().nonnegative().optional(),
  payload: z.object({
    commandId: Id,
    ok: z.literal(true),
    data: z.unknown().optional(),
  }),
})
```

- [ ] **Step 4: 新增 REST DTO**

`packages/protocol/src/api.ts`：

```ts
import { z } from 'zod'
import { Id } from './common.js'
import { TaskStatus } from './enums.js'
import { Approval } from './entities/approval.js'
import { Canvas } from './entities/canvas.js'
import { Edge } from './entities/edge.js'
import { Node } from './entities/node.js'
import { Review } from './entities/review.js'
import { Session } from './entities/session.js'
import { Task } from './entities/task.js'
import { Workspace } from './entities/workspace.js'

export const WorkspaceCreateInput = z.object({
  name: z.string().min(1),
  relPath: z.string().min(1),
})
export const WorkspaceListResponse = z.object({ workspaces: z.array(Workspace) })
export const WorkspaceCreateResponse = z.object({ workspace: Workspace, canvas: Canvas })
export const CanvasResponse = z.object({
  canvas: Canvas,
  nodes: z.array(Node),
  edges: z.array(Edge),
})
export const TaskListQuery = z.object({
  workspaceId: Id,
  status: TaskStatus.optional(),
})
export const TaskListResponse = z.object({ tasks: z.array(Task) })
export const TaskDetailResponse = z.object({
  task: Task,
  sessions: z.array(Session),
  approvals: z.array(Approval),
  review: Review.nullable(),
})

export type WorkspaceCreateInput = z.infer<typeof WorkspaceCreateInput>
export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponse>
export type WorkspaceCreateResponse = z.infer<typeof WorkspaceCreateResponse>
export type CanvasResponse = z.infer<typeof CanvasResponse>
export type TaskListQuery = z.infer<typeof TaskListQuery>
export type TaskListResponse = z.infer<typeof TaskListResponse>
export type TaskDetailResponse = z.infer<typeof TaskDetailResponse>
```

`packages/protocol/src/index.ts` 增加 `export * from './api.js'`。

- [ ] **Step 5: 增加 `maxConcurrency`**

`packages/protocol/src/config.ts`：

```ts
export const ConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(0).max(65535),
  token: z.string().min(1).nullable(),
  dataDir: z.string().min(1),
  webRoot: z.string().min(1),
  workspacesRoot: z.string().min(1),
  maxConcurrency: z.number().int().positive().default(1),
})
```

- [ ] **Step 6: 跑测试**

```bash
pnpm --filter @baton/protocol typecheck
pnpm --filter @baton/protocol test
```

Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): 增加 ack.data、REST DTO 与并发配置"
```

---

## Task 2: DB migration + event store

**Blocking:** Task 1
**Slice type:** tracer-bullet
**Seam:** `eventStore.appendSessionEvent(...)` / `eventStore.replay(sinceOrdinal)`

**Files:**
- Modify: `apps/daemon/src/db/schema.ts`
- Create: `apps/daemon/migrations/0001_*.sql`（drizzle-kit 生成后手工修正）
- Modify: `apps/daemon/migrations/meta/_journal.json`
- Create: `apps/daemon/src/db/event-store.ts`
- Create: `apps/daemon/src/db/repositories.ts`
- Create: `apps/daemon/test/helpers/db.ts`
- Modify: `apps/daemon/test/migrate.test.ts`
- Test: `apps/daemon/test/event-store.test.ts`

- [ ] **Step 1: 写失败测试**

`migrate.test.ts` 改为断言 12 张表与索引集合：

```ts
expect(before.filter((row) => row.type === 'table')).toHaveLength(12)
expect(
  before.filter((row) => row.type === 'index').map((row) => row.name).sort(),
).toEqual([
  'approval_session_request_idx',
  'audit_ts_idx',
  'event_ordinal_idx',
  'event_session_seq_idx',
  'node_canvas_idx',
  'task_status_idx',
  'workspace_rel_path_unique',
  'ws_event_ts_idx',
])
```

增加升级用例：先用旧 migration 建库并插入一条 event，再跑新 migration，断言 `ordinal` 非空、`review.verdict` 可空。

`event-store.test.ts`：

```ts
it('allocates global ordinals and per-session seq', () => {
  const db = createTestDb()
  const store = createEventStore(db, { now: () => 1, newId: () => crypto.randomUUID() })
  const a = store.appendSessionEvent({ sessionId: 's1', seq: 1, event: fakeEvent('a'), ts: 1 })
  const b = store.appendSessionEvent({ sessionId: 's2', seq: 1, event: fakeEvent('b'), ts: 2 })
  expect(b.ordinal).toBeGreaterThan(a.ordinal)
})

it('replays only events after the cursor, in order', () => {
  const db = createTestDb()
  const store = createEventStore(db, { now: () => 1, newId: () => crypto.randomUUID() })
  store.appendTaskStatus({ taskId: 't1', status: 'queued', previousStatus: 'todo', retryCount: 0, ts: 1 })
  store.appendTaskStatus({ taskId: 't1', status: 'running', previousStatus: 'queued', retryCount: 0, ts: 2 })
  const rows = store.replay(1, 100)
  expect(rows.map((row) => row.type)).toEqual(['task.status'])
  expect(rows[0]!.ordinal).toBe(2)
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @evanfang0054/baton test
```

Expected: 表数量/索引不匹配，`event-store` 不存在。

- [ ] **Step 3: 更新 Drizzle schema**

`apps/daemon/src/db/schema.ts` 增加：

```ts
export const wsEvent = sqliteTable(
  'ws_event',
  {
    ordinal: integer('ordinal').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull(),
    ts: integer('ts').notNull(),
  },
  (t) => [index('ws_event_ts_idx').on(t.ts)],
)
```

`event` 增加：

```ts
ordinal: integer('ordinal').notNull(),
```

并在表回调里增加 `uniqueIndex('event_ordinal_idx').on(t.ordinal)`。

`approval` 增加：

```ts
requestId: text('request_id'),
```

并增加 `index('approval_session_request_idx').on(t.sessionId, t.requestId)`。

`review.verdict` 改为 `text('verdict')`（去掉 `.notNull()`）。

- [ ] **Step 4: 生成 migration**

```bash
pnpm --filter @evanfang0054/baton exec drizzle-kit generate
```

检查生成的 `0001_*.sql`：

- `ws_event` 的 `ordinal INTEGER PRIMARY KEY AUTOINCREMENT`。
- `event` 的 `ordinal` 非空；如 drizzle-kit 生成 `ALTER TABLE event ADD ordinal`，手工改成 table rebuild 并回填 `ROW_NUMBER() OVER (ORDER BY ts, id)`。
- `review` 的 `verdict` 去掉 `NOT NULL`；用 table rebuild。
- `approval.request_id` 用 `ALTER TABLE ... ADD COLUMN`。
- 所有 `CREATE INDEX` 与 spec 4.5 一致。

在 `migrate.test.ts` 中加“旧库升级”用例：先只跑 `0000`，插入一条 event/review，再跑全部 migration。

- [ ] **Step 5: 实现 event store**

`apps/daemon/src/db/event-store.ts`：

```ts
export interface EventStoreDeps {
  now: () => number
  newId: () => string
}

export function createEventStore(db: Db, deps: EventStoreDeps) {
  function appendWs(
    tx: Db,
    input: { type: ServerMessage['type']; payload: unknown; ts: number },
  ): { id: string; ordinal: number } {
    const id = deps.newId()
    const result = tx
      .insert(wsEvent)
      .values({
        id,
        type: input.type,
        payloadJson: JSON.stringify(input.payload),
        ts: input.ts,
      })
      .run()
    return { id, ordinal: Number(result.lastInsertRowid) }
  }

  function appendSessionEvent(input: {
    sessionId: string
    seq: number
    event: AgentEvent
    ts?: number
  }): { id: string; ordinal: number } {
    return db.transaction((tx) => {
      const ts = input.ts ?? deps.now()
      const ws = appendWs(tx, {
        type: 'session.event',
        payload: { sessionId: input.sessionId, event: input.event },
        ts,
      })
      tx.insert(event).values({
        id: deps.newId(),
        sessionId: input.sessionId,
        ordinal: ws.ordinal,
        seq: input.seq,
        type: input.event.type,
        payloadJson: JSON.stringify(input.event),
        ts,
      }).run()
      return ws
    })
  }

  function replay(sinceOrdinal: number, limit = 5000) {
    return db
      .select()
      .from(wsEvent)
      .where(gt(wsEvent.ordinal, sinceOrdinal))
      .orderBy(asc(wsEvent.ordinal))
      .limit(limit + 1)
      .all()
  }

  return { appendWs, appendSessionEvent, replay }
}
```

说明：

- `appendWs` 必须在调用方的事务里使用；`appendSessionEvent` 自己开事务。
- `replay` 多取一条用于判断 `hasMore`。
- `appendTaskStatus` / `appendApprovalRequest` / `appendVerifyResult` 可以在 `appendWs` 之上做薄封装。

- [ ] **Step 6: 实现 repositories**

`repositories.ts` 只放行级读写：

- `getWorkspace(id)`, `getWorkspaceByRelPath(relPath)`, `listWorkspaces()`, `createWorkspaceWithCanvas(...)`.
- `getCanvasByWorkspace(workspaceId)`, `listNodes(canvasId)`, `listEdges(canvasId)`.
- `getTask(id)`, `listTasks({ workspaceId, status })`, `insertTask(...)`, `updateTaskState(tx, ...)`.
- `insertSession`, `updateSessionStatus`, `getSessionsByTask`.
- `insertApproval`, `getApproval`, `updateApprovalDecision`, `listApprovalsByTask`.
- `insertReview`, `getReview`, `updateReviewVerdict`, `getReviewByTask`（取最新一条；verify 字段为空时返回 `null`）.
- `insertAudit`.
- 所有返回 JSON 字段的行用 zod 实体 `.parse` 校验，避免脏数据进入状态机。

- [ ] **Step 7: 跑测试**

```bash
pnpm --filter @evanfang0054/baton typecheck
pnpm --filter @evanfang0054/baton test
```

Expected: migration 与 event store 测试全绿。

- [ ] **Step 8: Commit**

```bash
git add apps/daemon/src/db apps/daemon/migrations apps/daemon/test
git commit -m "feat(daemon): 增加 ws_event、全局 ordinal 与重放存储"
```

---

## Task 3: Workspace、policy 与上下文输入

**Blocking:** Task 2
**Slice type:** tracer-bullet
**Seam:** `resolveWithin(root, rel)` / `loadPolicy(workspacePath)` / `buildContextInput(...)`

**Files:**
- Create: `apps/daemon/src/workspace/resolver.ts`
- Create: `apps/daemon/src/workspace/policy.ts`
- Create: `apps/daemon/src/workspace/context.ts`
- Modify: `apps/daemon/src/runtime/task-service.ts`（先实现 `createTask`）
- Test: `apps/daemon/test/workspace.test.ts`, `apps/daemon/test/policy.test.ts`, `apps/daemon/test/context-input.test.ts`, `apps/daemon/test/task-service.test.ts`

- [ ] **Step 1: 写失败测试**

`workspace.test.ts`：

```ts
it('rejects absolute paths, traversal and symlink escapes', () => {
  expect(() => resolveWithin('/tmp/ws', '/etc/passwd')).toThrow()
  expect(() => resolveWithin('/tmp/ws', '../outside')).toThrow()
  expect(() => resolveWithin('/tmp/ws', 'a/../../outside')).toThrow()
})

it('accepts a nested directory inside root', () => {
  expect(resolveWithin('/tmp/ws', 'packages/app')).toBe('/tmp/ws/packages/app')
})
```

symlink 用例用 `fs.symlinkSync` 在临时目录里创建指向外部的链接，断言抛错。

`policy.test.ts`：

```ts
it('falls back to DEFAULT policy when file is absent', () => {
  const policy = loadPolicy('/tmp/ws')
  expect(policy.approval.default).toBe('ask')
  expect(policy.autopilot.enabled).toBe(false)
})

it('rejects invalid policy JSON with invalid_policy', () => {
  writeFileSync(join(ws, '.baton/policy.json'), '{')
  expect(() => loadPolicy(ws)).toThrowError(/invalid_policy/)
})
```

`context-input.test.ts`：

```ts
it('does not read sensitive file nodes', () => {
  const input = buildContextInput({
    nodes: [fileNode('n1', '.env'), fileNode('n2', 'src/app.ts')],
    edges: [],
    workspacePath: ws,
  })
  expect(input.contentByNodeId.n1).toBeNull()
  expect(input.contentByNodeId.n2).toContain('export')
})
```

`task-service.test.ts`：

```ts
it('creates a todo task with an assembled prompt', () => {
  const runtime = createTestRuntime()
  const { taskId } = runtime.createTask({
    workspaceId: 'w1',
    nodeId: 'agent-1',
    title: 'demo',
    prompt: '把登录页改成暗黑模式',
    contextNodeIds: ['text-1'],
    engine: 'fake',
    workspaceMode: 'main',
  })
  const task = runtime.getTask(taskId)
  expect(task.status).toBe('todo')
  expect(task.prompt).toContain('<task>把登录页改成暗黑模式</task>')
  expect(task.prompt).toContain('<node id="text-1"')
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @evanfang0054/baton test -- workspace policy context-input task-service
```

Expected: 文件不存在/函数未实现。

- [ ] **Step 3: 实现 resolver**

`resolver.ts` 关键逻辑：

```ts
export function resolveWithin(root: string, relPath: string): string {
  if (path.isAbsolute(relPath)) throw appError('invalid_path', 'absolute path is not allowed')
  const normalized = path.normalize(relPath)
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw appError('invalid_path', 'path escapes workspace')
  }
  const abs = path.resolve(root, normalized)
  const realRoot = realpathSync(root)
  const target = existsSync(abs) ? realpathSync(abs) : abs
  if (target !== realRoot && !target.startsWith(`${realRoot}${path.sep}`)) {
    throw appError('invalid_path', 'path escapes workspace')
  }
  return abs
}
```

补充：

- `readWorkspaceText(workspacePath, relPath, maxBytes=256*1024)`：敏感路径直接返回 `null`；非文件/超限/非文本扩展名返回 `null`；否则 UTF-8 读取。
- 文本扩展名 allowlist 放 `context.ts`，不放进 core。
- `POST /api/workspaces` 的目录存在校验复用 `resolveWithin`。

- [ ] **Step 4: 实现 policy loader**

`policy.ts`：

```ts
export function loadPolicy(workspacePath: string): Policy {
  const file = join(workspacePath, '.baton', 'policy.json')
  if (!existsSync(file)) return PolicySchema.parse({})
  const real = realpathSync(file)
  if (!real.startsWith(`${realpathSync(workspacePath)}${path.sep}`)) {
    throw appError('invalid_policy', 'policy file escapes workspace')
  }
  try {
    return PolicySchema.parse(JSON.parse(readFileSync(real, 'utf8')))
  } catch {
    throw appError('invalid_policy', 'invalid .baton/policy.json')
  }
}
```

不把 JSON 原文放进 `message`/`details`。

- [ ] **Step 5: 实现上下文输入**

`context.ts`：

- `buildContextInput({ nodes, edges, workspacePath })` 返回 `{ contentByNodeId }`。
- file 节点：`isSensitivePath(node.data.path)` → `null`；否则 `readWorkspaceText`。
- 只处理 file；text/image 不需要预读。
- 不修改节点数据。

- [ ] **Step 6: 实现 `createTask`**

`task-service.ts` 的 `createTask`：

1. `getWorkspace` → `resolveWithin(workspacesRoot, workspace.relPath)`。
2. `getCanvasByWorkspace`；`listNodes`/`listEdges`。
3. 校验 `nodeId` 是 agent 节点；`contextNodeIds` 都在 canvas。
4. `loadPolicy`。
5. `buildContextInput`。
6. `assembleContext`。
7. `insertTask`，status `todo`，prompt 为装配结果。
8. 返回 `{ taskId }`。

错误用 `AppError`：`workspace_not_found`、`canvas_not_found`、`node_not_found`、`invalid_payload`、`unsupported`、`unsupported_engine`。

- [ ] **Step 7: 跑测试**

```bash
pnpm --filter @evanfang0054/baton typecheck
pnpm --filter @evanfang0054/baton test -- workspace policy context-input task-service
```

- [ ] **Step 8: Commit**

```bash
git add apps/daemon/src/workspace apps/daemon/src/runtime/task-service.ts apps/daemon/test
git commit -m "feat(daemon): 增加工作区校验、策略加载与上下文装配"
```

---

## Task 4: Transition runner + scheduler

**Blocking:** Task 3
**Slice type:** tracer-bullet
**Seam:** `applyTransition(taskId, event)` / `scheduler.pump()`

**Files:**
- Create: `apps/daemon/src/runtime/types.ts`
- Create: `apps/daemon/src/runtime/effects.ts`
- Create: `apps/daemon/src/runtime/scheduler.ts`
- Modify: `apps/daemon/src/runtime/task-service.ts`
- Test: `apps/daemon/test/task-service.test.ts`, `apps/daemon/test/scheduler.test.ts`

- [ ] **Step 1: 写失败测试**

`task-service.test.ts`：

```ts
it('writes status only through transition and keeps emitTaskStatus last', () => {
  const runtime = createTestRuntime()
  const { taskId } = runtime.createTask(createInput())
  const outcome = runtime.applyTransition(taskId, { type: 'enqueue' })
  expect(outcome.ok).toBe(true)
  expect(runtime.getTask(taskId).status).toBe('queued')
  expect(outcome.events.map((e) => e.type)).toEqual(['task.status'])
})

it('rejects invalid transitions without writing', () => {
  const runtime = createTestRuntime()
  const { taskId } = runtime.createTask(createInput())
  const outcome = runtime.applyTransition(taskId, { type: 'start' })
  expect(outcome.ok).toBe(false)
  expect(runtime.getTask(taskId).status).toBe('todo')
})
```

`scheduler.test.ts`：

```ts
it('starts only one task when maxConcurrency is 1', async () => {
  const runtime = createTestRuntime({ maxConcurrency: 1 })
  const t1 = runtime.createTask(createInput({ title: 'one' }))
  const t2 = runtime.createTask(createInput({ title: 'two' }))
  runtime.applyTransition(t1.taskId, { type: 'enqueue' })
  runtime.applyTransition(t2.taskId, { type: 'enqueue' })
  await runtime.scheduler.idle()
  expect(runtime.getTask(t1.taskId).status).toBe('running')
  expect(runtime.getTask(t2.taskId).status).toBe('queued')
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @evanfang0054/baton test -- task-service scheduler
```

- [ ] **Step 3: 定义 runtime types**

`types.ts`：

```ts
export interface RuntimeDeps {
  db: Db
  config: Config
  hub: WsHub
  adapters: AdapterFactory
  verify: VerifyRunner
  now?: () => number
  newId?: () => string
  logger?: Logger
}

export interface ActiveRun {
  taskId: string
  sessionId: string
  run: AgentRun
  requestIdByApprovalId: Map<string, string>
}

export interface TransitionOutcome {
  ok: boolean
  status?: TaskStatus
  previousStatus?: TaskStatus
  retryCount?: number
  events: WsEventDraft[]
  error?: AppError
}
```

- [ ] **Step 4: 实现 effects**

`effects.ts` 的核心：

```ts
export interface EffectPlan {
  db: Array<(tx: Db) => void>
  events: WsEventDraft[]
  afterCommit: Array<() => Promise<void> | void>
}

export function planEffects(input: {
  effects: TaskEffect[]
  task: Task
  previousStatus: TaskStatus
  retryCount: number
  tx: Db
  deps: ...
}): EffectPlan
```

每个 effect 的处理：

- `requestApproval`：`updateSessionStatus(tx, sessionId, 'waiting_input')`；`events.push({ type:'approval.request', payload })`。
- `resolveApproval`：`updateApprovalDecision(tx, approvalId, ...)`；`updateSessionStatus(tx, sessionId, 'running')`；`afterCommit.push(() => activeRun.run.approve(requestId, decision, note))`。
- `persistVerifyResult`：`insertReview(tx, ...)`；`events.push({ type:'verify.result', payload })`。
- `persistReviewVerdict`：`updateReviewVerdict(tx, reviewId, verdict)`。
- `appendFeedback`：`appendTaskFeedback(tx, taskId, feedback, 16_384)`。
- `incrementRetry`：`insertAudit(tx, 'task.retry', ...)`。
- `startSession`：`insertSession(tx, ...)` → `afterCommit.push(() => sessionRunner.start(...))`。
- `interruptSession`：`updateSessionStatus(tx, sessionId, 'ended')` → `afterCommit.push(() => activeRun.run.interrupt())`。
- `enqueueTask`：`afterCommit.push(() => scheduler.kick())`。
- `emitTaskStatus`：`events.push({ type:'task.status', payload })`（必须最后）。

在事务里按 `plan.events` 顺序调用 `eventStore.appendWs(tx, ...)`；广播在提交后按同样顺序发送。

- [ ] **Step 5: 实现 `applyTransition`**

```ts
export function applyTransition(taskId: string, event: TaskTransitionEvent): TransitionOutcome {
  const task = getTask(taskId)
  const previousStatus = task.status
  const runningCount = countActiveTasks()
  const policy = loadPolicy(workspacePath)
  const result = transition(
    {
      status: task.status,
      retryCount: task.retryCount,
      runningCount,
      maxConcurrency: config.maxConcurrency,
      autopilot: policy.autopilot,
    },
    event,
  )
  if (!result.ok) return { ok: false, error: result.error, events: [] }

  let plan!: EffectPlan
  db.transaction((tx) => {
    updateTaskState(tx, taskId, result.status, result.retryCount)
    plan = planEffects({ effects: result.effects, ... })
    for (const draft of plan.events) eventStore.appendWs(tx, draft)
  })

  broadcast(plan.events)
  for (const action of plan.afterCommit) void runAction(action)
  return { ok: true, status: result.status, previousStatus, retryCount: result.retryCount, events: plan.events }
}
```

约束：

- `updateTaskState` 只能在这里调用。
- `events` 的最后一项必须是 `task.status`。
- `afterCommit` 的错误：`startSession` → `applyTransition(error)`；`resolveApproval` → `applyTransition(error)`；`interruptSession` 只记录。
- `runAction` 用 `void` 启动，但测试需要等待：提供 `runtime.settle()` 等待所有 in-flight actions。

- [ ] **Step 6: 实现 scheduler**

```ts
export function createScheduler(runtime: Runtime) {
  let pumping = false
  async function pump(): Promise<void> {
    if (pumping) return
    pumping = true
    try {
      while (true) {
        const running = runtime.countActiveTasks()
        if (running >= runtime.config.maxConcurrency) break
        const next = runtime.findNextQueued()
        if (!next) break
        const outcome = runtime.applyTransition(next.id, { type: 'start' })
        if (!outcome.ok) break
      }
    } finally {
      pumping = false
    }
  }
  return { pump, kick: () => void pump() }
}
```

- [ ] **Step 7: 跑测试**

```bash
pnpm --filter @evanfang0054/baton typecheck
pnpm --filter @evanfang0054/baton test -- task-service scheduler
```

- [ ] **Step 8: Commit**

```bash
git add apps/daemon/src/runtime apps/daemon/test
git commit -m "feat(daemon): 增加状态转移执行器与并发调度"
```

---

## Task 5: Session runner、审批与重启收敛

**Blocking:** Task 4
**Slice type:** tracer-bullet
**Seam:** `sessionRunner.start(...)` / `CUSTOM approval.request` / `reconcileOnBoot()`

**Files:**
- Create: `apps/daemon/src/runtime/adapter-factory.ts`
- Create: `apps/daemon/src/runtime/session-runner.ts`
- Create: `apps/daemon/src/runtime/boot.ts`
- Test: `apps/daemon/test/session-runner.test.ts`, `apps/daemon/test/boot.test.ts`

- [ ] **Step 1: 写失败测试**

`session-runner.test.ts`：

```ts
it('asks for approval, waits for allow, then finishes into review', async () => {
  const runtime = createTestRuntime({
    adapters: { fake: () => new FakeAdapter() },
  })
  const { taskId } = runtime.createTask(createInput())
  runtime.applyTransition(taskId, { type: 'enqueue' })
  await runtime.scheduler.idle()

  const approval = await runtime.nextEvent('approval.request')
  runtime.applyTransition(taskId, { type: 'approval_allow', approvalId: approval.payload.approvalId })
  await runtime.waitForStatus(taskId, 'review')

  expect(runtime.getTask(taskId).status).toBe('review')
  expect(runtime.getReviewByTask(taskId).verifyExitCode).toBe(0)
})
```

`boot.test.ts`：

```ts
it('fails running tasks and cancels verifying tasks on boot', async () => {
  const runtime = createTestRuntime()
  seedTask(runtime, { status: 'running', session: 'running' })
  seedTask(runtime, { status: 'verifying' })
  await runtime.reconcileOnBoot()
  expect(runtime.getTask('t-running').status).toBe('failed')
  expect(runtime.getTask('t-verifying').status).toBe('cancelled')
  expect(runtime.getSession('s-running').status).toBe('failed')
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @evanfang0054/baton test -- session-runner boot
```

- [ ] **Step 3: 实现 adapter factory**

`adapter-factory.ts`：

```ts
export type AdapterFactory = (engine: Engine) => AgentAdapter

export function createAdapterFactory(overrides: Partial<Record<Engine, AgentAdapter>> = {}): AdapterFactory {
  return (engine) => {
    const adapter = overrides[engine]
    if (adapter) return adapter
    if (engine === 'fake') return new FakeAdapter()
    throw appError('unsupported_engine', `engine ${engine} is not available in M1-5`)
  }
}
```

- [ ] **Step 4: 实现 session runner**

`session-runner.ts`：

- `start({ task, sessionId, workspacePath, policy })`：
  - `adapter.start({ prompt, cwd, permissionMode: 'manual', policy })`。
  - `activeRuns.set(sessionId, { taskId, sessionId, run, requestIdByApprovalId })`。
  - 启动 `consume(run.events)`。
- `consume`：
  - `for await` 事件；`seq += 1`；`eventStore.appendSessionEvent(...)`；广播。
  - `RUN_STARTED`：`updateSessionEngineId`。
  - `CUSTOM approval.request`：见 spec 5.5；`approvalId = newId()`；`insertApproval`；`evaluateApproval`；auto/ask 分支。若 `approval_requested` 转移失败，approval 行标 `deny/system` 并写 audit `approval.expired`。
  - `RUN_FINISHED`：`applyTransition(completed)`；`updateSessionStatus('ended')`；`break`。
  - `RUN_ERROR`：`applyTransition(error)`；`updateSessionStatus('failed')`；`break`。
  - 流结束未收到终止事件：`applyTransition(error)`。
  - 每个事件前检查 task 状态；若已 `cancelled`，直接 `break`，不再落库/广播/转移。
  - `finally`：`run.dispose()`；`activeRuns.delete(sessionId)`。
- `approve(approvalId, decision, note)`：
  - 从 `activeRuns` 找 `requestId`；找不到抛 `approval_expired`。
  - 调用 `run.approve`。
- `interrupt(taskId)`：找 active run；`run.interrupt()`。

- [ ] **Step 5: 实现重启收敛**

`boot.ts`：

```ts
export async function reconcileOnBoot(runtime: Runtime): Promise<void> {
  const activeSessions = runtime.listSessionsByStatus(['running', 'waiting_input'])
  for (const session of activeSessions) runtime.updateSessionStatus(session.id, 'failed')
  for (const task of runtime.listTasksByStatus(['running', 'waiting_input'])) {
    runtime.applyTransition(task.id, { type: 'error', message: 'daemon restarted' })
  }
  for (const task of runtime.listTasksByStatus(['verifying'])) {
    runtime.applyTransition(task.id, { type: 'cancel', reason: 'daemon restarted during verify' })
  }
  for (const approval of runtime.listPendingApprovals()) {
    runtime.expireApproval(approval.id)
  }
}
```

- [ ] **Step 6: 跑测试**

```bash
pnpm --filter @evanfang0054/baton typecheck
pnpm --filter @evanfang0054/baton test -- session-runner boot
```

- [ ] **Step 7: Commit**

```bash
git add apps/daemon/src/runtime apps/daemon/test
git commit -m "feat(daemon): 接通 agent-fake 会话、审批与重启收敛"
```

---

## Task 6: Verify 执行器

**Blocking:** Task 5
**Slice type:** tracer-bullet
**Seam:** `verifyRunner.run({ task, workspacePath, policy })`

**Files:**
- Create: `apps/daemon/src/verify/executor.ts`
- Create: `apps/daemon/src/verify/output.ts`
- Create: `apps/daemon/src/verify/env.ts`
- Test: `apps/daemon/test/verify-executor.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('truncates output to head and tail', () => {
  const out = truncateOutput('a'.repeat(100) + 'b'.repeat(100), 40)
  expect(out).toContain('truncated')
  expect(out.startsWith('a'.repeat(20))).toBe(true)
  expect(out.endsWith('b'.repeat(20))).toBe(true)
})

it('strips sensitive env keys', () => {
  const env = sanitizeEnv({
    PATH: '/usr/bin',
    BATON_TOKEN: 'secret',
    ANTHROPIC_API_KEY: 'secret',
    MY_API_KEY: 'secret',
    HOME: '/home/user',
  })
  expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/user' })
})

it('runs a successful verify command in the workspace', async () => {
  const result = await runVerify({
    taskId: 't1',
    workspacePath: ws,
    command: 'node -e "process.exit(0)"',
    timeoutSec: 5,
    maxOutputBytes: 1024,
  })
  expect(result.exitCode).toBe(0)
  expect(result.durationMs).toBeGreaterThanOrEqual(0)
})

it('kills the process group on timeout', async () => {
  const result = await runVerify({
    taskId: 't1',
    workspacePath: ws,
    command: 'node -e "setTimeout(() => {}, 60000)"',
    timeoutSec: 1,
    maxOutputBytes: 1024,
  })
  expect(result.exitCode).toBe(124)
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @evanfang0054/baton test -- verify-executor
```

- [ ] **Step 3: 实现 output/env**

`output.ts`：

```ts
export function truncateOutput(input: string, maxBytes: number): string {
  const max = Math.max(0, maxBytes)
  if (Buffer.byteLength(input, 'utf8') <= max) return input
  const half = Math.floor(max / 2)
  const head = Buffer.from(input, 'utf8').subarray(0, half).toString('utf8')
  const tail = Buffer.from(input, 'utf8').subarray(-half).toString('utf8')
  return `${head}\n…[truncated ${Buffer.byteLength(input, 'utf8') - max} bytes]…\n${tail}`
}
```

`env.ts`：

```ts
export function sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (key.startsWith('BATON_')) continue
    if (key === 'ANTHROPIC_API_KEY') continue
    if (/token|secret|authorization|api[_-]?key/i.test(key)) continue
    safe[key] = value
  }
  return safe
}
```

- [ ] **Step 4: 实现 executor**

`executor.ts`：

```ts
export async function runVerify(input: VerifyRunInput): Promise<VerifyRunResult> {
  const started = Date.now()
  const command = input.command
  try {
    const subprocess = execa(command, {
      shell: true,
      cwd: input.workspacePath,
      env: sanitizeEnv(process.env),
      timeout: input.timeoutSec * 1000,
      forceKillAfterDelay: 5000,
      detached: true,
      reject: false,
      maxBuffer: input.maxOutputBytes * 4,
    })
    input.signal?.addEventListener('abort', () => {
      if (subprocess.pid) process.kill(-subprocess.pid, 'SIGTERM')
    })
    const result = await subprocess
    const output = truncateOutput(
      `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
      input.maxOutputBytes,
    )
    return {
      exitCode: result.timedOut ? 124 : (result.exitCode ?? 127),
      output,
      diffStat: await readDiffStat(input.workspacePath),
      durationMs: Date.now() - started,
    }
  } catch (error) {
    const exitCode = isTimeout(error) ? 124 : 127
    return {
      exitCode,
      output: truncateOutput(error instanceof Error ? error.message : 'verify failed', input.maxOutputBytes),
      diffStat: await readDiffStat(input.workspacePath),
      durationMs: Date.now() - started,
    }
  }
}
```

`readDiffStat`：

```ts
async function readDiffStat(cwd: string): Promise<DiffStat> {
  try {
    const numstat = await execa('git', ['-C', cwd, 'diff', '--numstat'], { reject: false })
    let filesChanged = 0
    let insertions = 0
    let deletions = 0
    for (const line of numstat.stdout.split('\n')) {
      if (!line.trim()) continue
      const [add, del] = line.split('\t')
      filesChanged += 1
      insertions += Number(add) || 0
      deletions += Number(del) || 0
    }
    const untracked = await execa('git', ['-C', cwd, 'ls-files', '--others', '--exclude-standard'], { reject: false })
    filesChanged += untracked.stdout.split('\n').filter(Boolean).length
    return { filesChanged, insertions, deletions }
  } catch {
    return { filesChanged: 0, insertions: 0, deletions: 0 }
  }
}
```

- [ ] **Step 5: 接入状态机**

`runtime` 的 `runVerify` afterCommit：

1. `resolveVerifyCommand`（task/policy/package scripts）。
2. `verifyRunner.run(...)`。
3. `newReviewId = newId()`；把 `durationMs` 写入 `verifyMetaByReviewId`。
4. `applyTransition(taskId, { type: exitCode === 0 ? 'verify_ok' : 'verify_fail', reviewId, exitCode, output, diffStat })`；`persistVerifyResult` effect 从 `verifyMetaByReviewId` 取 `durationMs` 组装 `verify.result`，写完后删除。
5. `verifyRunner` 维护 `Map<taskId, AbortController>`；`cancel(taskId)` abort。完成回调先读 task 状态，已 `cancelled` 则丢弃结果。

- [ ] **Step 6: 跑测试**

```bash
pnpm --filter @evanfang0054/baton typecheck
pnpm --filter @evanfang0054/baton test -- verify-executor
```

- [ ] **Step 7: Commit**

```bash
git add apps/daemon/src/verify apps/daemon/src/runtime apps/daemon/test
git commit -m "feat(daemon): 增加 verify 执行器与 diff 证据"
```

---

## Task 7: WS router、REST、鉴权与日志

**Blocking:** Task 6
**Slice type:** tracer-bullet
**Seam:** `attachWs(app, config, runtime, hub)` / `GET /api/workspaces`

**Files:**
- Create: `apps/daemon/src/ws/hub.ts`
- Create: `apps/daemon/src/ws/router.ts`
- Modify: `apps/daemon/src/ws/server.ts`
- Create: `apps/daemon/src/http/api-auth.ts`
- Create: `apps/daemon/src/http/workspaces.ts`
- Create: `apps/daemon/src/http/canvas.ts`
- Create: `apps/daemon/src/http/tasks.ts`
- Create: `apps/daemon/src/http/errors.ts`
- Create: `apps/daemon/src/log.ts`
- Modify: `apps/daemon/src/app.ts`
- Modify: `apps/daemon/src/bootstrap.ts`
- Modify: `apps/daemon/src/start.ts`
- Modify: `apps/daemon/src/config.ts`
- Modify: `apps/daemon/test/health.test.ts`, `apps/daemon/test/static.test.ts`, `apps/daemon/test/ws.test.ts`, `apps/daemon/test/bootstrap.test.ts`
- Test: `apps/daemon/test/ws-router.test.ts`, `apps/daemon/test/rest-api.test.ts`

- [ ] **Step 1: 写失败测试**

`ws-router.test.ts`：

```ts
it('acks task.create with taskId', async () => {
  const { ws, send } = await connectTestWs()
  send({ v: 1, type: 'task.create', id: 'c1', ts: 1, payload: createPayload() })
  const ack = await ws.next('ack')
  expect(ack.payload.data.taskId).toBeTruthy()
})

it('replays from sinceSeq after reconnect', async () => {
  const first = await connectTestWs()
  first.send({ v: 1, type: 'resume', id: 'r1', ts: 1, payload: { sinceSeq: 0 } })
  const ack = await first.next('ack')
  expect(ack.payload.data.cursor).toBeGreaterThanOrEqual(0)
})
```

`rest-api.test.ts`：

```ts
it('requires auth except health', async () => {
  const app = await buildTestApp({ token: 'secret' })
  expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
  expect((await app.inject({ method: 'GET', url: '/api/workspaces' })).statusCode).toBe(401)
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/api/workspaces',
        headers: { authorization: 'Bearer secret' },
      })
    ).statusCode,
  ).toBe(200)
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @evanfang0054/baton test -- ws-router rest-api
```

- [ ] **Step 3: 实现 WsHub**

`hub.ts`：

```ts
export interface WsHub {
  register(socket: WebSocket): void
  broadcast(event: WsEventDraft): void
  close(): void
}

export function createWsHub(logger: Logger): WsHub {
  const sockets = new Set<WebSocket>()
  return {
    register(socket) {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    },
    broadcast(event) {
      const frame = JSON.stringify({ v: 1, id: event.id, type: event.type, ts: event.ts, seq: event.ordinal, payload: event.payload })
      for (const socket of sockets) {
        if (socket.readyState !== socket.OPEN) continue
        if (socket.bufferedAmount > 8 * 1024 * 1024) {
          socket.close(1013, 'slow client')
          continue
        }
        socket.send(frame)
      }
    },
    close() {
      for (const socket of sockets) socket.close(1001, 'server closing')
      sockets.clear()
    },
  }
}
```

- [ ] **Step 4: 实现 router**

`router.ts`：

- `ping` 先处理。
- `ClientMessage.safeParse`；失败发 `error`。
- `switch (message.type)` 分发到 runtime。
- 每个分支：`const outcome = runtime.handleCommand(message)`；若 `ok` 发 `ack`（带 `data`），否则发 `error`。
- `resume` 单独：`runtime.replay(sinceSeq)` → 发送 → `ack {cursor, hasMore}`。
- `error` 用 `ErrorEvent.parse` 构造，`commandId` 填原命令 id。

- [ ] **Step 5: 实现 REST + auth + errors**

- `api-auth.ts`：`preHandler` 检查 `Authorization: Bearer`、`baton_token` cookie、`?token=`；`config.token` 为 null 时放行（本地模式）。`/api/health` 不注册。
- `workspaces.ts`：复用 `resolveWithin`；`createWorkspaceWithCanvas` 事务；返回 zod 校验后的响应。
- `canvas.ts`：`getCanvasByWorkspace` + nodes/edges；`viewport_json`/`data_json` 解析失败返回 `internal`。
- `tasks.ts`：list/detail；404 用 `not_found`。
- `errors.ts`：`app.setErrorHandler` 映射 spec 5.9 的状态码；响应体 `{ code, message, details? }`。

- [ ] **Step 6: 接入 app/bootstrap/start**

- `buildApp(config, deps)`：`deps = { runtime, hub, logger }`。
- `bootstrap`：`openDb` → `migrateDb` → `createLogger` → `createWsHub` → `createRuntime` → `reconcileOnBoot` → `buildApp`。
- `start`：`app.listen` → `runtime.start()`；`shutdown` 时 `runtime.close()`、`hub.close()`、`app.close()`、`db.close()`。
- `config.ts`：解析 `maxConcurrency`，非正整数抛错。
- 更新 `health/static/ws/bootstrap` 测试：用 `buildTestApp` 或传 `deps`。

- [ ] **Step 7: 加 pino**

`log.ts`：

```ts
import pino from 'pino'

export function createLogger(level = process.env.BATON_LOG_LEVEL ?? 'info') {
  return pino({
    level,
    redact: {
      paths: ['token', '*.token', '*.authorization', '*.apiKey', '*.secret', 'req.headers.authorization'],
      censor: '[redacted]',
    },
  })
}
```

运行时日志只传 id/status/duration/exitCode，不传 prompt/event payload。

- [ ] **Step 8: 跑测试**

```bash
pnpm --filter @evanfang0054/baton typecheck
pnpm --filter @evanfang0054/baton test
```

- [ ] **Step 9: Commit**

```bash
git add apps/daemon
git commit -m "feat(daemon): 增加 WS 命令路由、REST 读取面与鉴权"
```

---

## Task 8: 端到端验收、文档与全量校验

**Blocking:** Task 7
**Slice type:** verification
**Seam:** `runtime-e2e.test.ts` / `pnpm verify`

**Files:**
- Create: `apps/daemon/test/runtime-e2e.test.ts`
- Create: `apps/daemon/test/failure-paths.test.ts`
- Create: `apps/daemon/test/replay.test.ts`
- Create: `apps/daemon/test/concurrency.test.ts`
- Modify: `docs/README.md`
- Modify: `THIRD_PARTY_NOTICES.md`
- Modify: `apps/daemon/package.json`
- Modify: `apps/daemon/tsup.config.ts`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: 写端到端测试**

`runtime-e2e.test.ts`：

```ts
it('runs create → approval → verify → review → done over WS', async () => {
  const { app, ws, runtime } = await buildRuntimeApp({ maxConcurrency: 1 })
  const create = await ws.command('task.create', createPayload())
  const taskId = create.payload.data.taskId
  await ws.command('task.enqueue', { taskId })

  const approval = await ws.next('approval.request')
  await ws.command('approval.decide', {
    approvalId: approval.payload.approvalId,
    decision: 'allow',
  })

  const verify = await ws.next('verify.result')
  expect(verify.payload.exitCode).toBe(0)

  const review = runtime.getReviewByTask(taskId)
  await ws.command('review.decide', { reviewId: review.id, decision: 'approve' })
  await ws.nextStatus(taskId, 'done')

  expect(runtime.getTask(taskId).status).toBe('done')
  expect(runtime.getReviewByTask(taskId).verdict).toBe('approved')
})
```

`failure-paths.test.ts`：

- approval deny → 任务继续/结束，approval `deny/user`。
- verify fail 无 autopilot → `review`，`verifyExitCode != 0`。
- verify fail 有 autopilot → 第一次 `queued`，第二次 `running`，`retryCount=1`。
- reject → `queued`，`task.prompt` 含 `<feedback>`。
- cancel running → `cancelled`，session 结束。
- cancel verifying → `cancelled`，子进程结束。

`replay.test.ts`：

- 连接 A 建任务并收事件；断开；连接 B `resume {sinceSeq}`；断言收到缺失的 `task.status`/`session.event`/`approval.request`/`verify.result`，顺序按 ordinal，无重复。

`concurrency.test.ts`：

- `maxConcurrency=1`；两个任务；第一个 `review` 前第二个 `queued`；第一个 `review` 后第二个 `running`；`verifying` 计入槽。

- [ ] **Step 2: 补依赖与打包**

`apps/daemon/package.json`：

```json
{
  "dependencies": {
    "execa": "^9.6.0",
    "pino": "^9.14.0"
  },
  "devDependencies": {
    "@baton/core": "workspace:*",
    "@baton/adapters": "workspace:*"
  }
}
```

版本以实施时 `npm view execa version` / `npm view pino version` 为准；许可均为 MIT。

`apps/daemon/tsup.config.ts`：

```ts
noExternal: [/^@baton\//],
```

`THIRD_PARTY_NOTICES.md` 增加 `pino`（MIT）；`execa` 已在表格中，补“直接依赖”说明。

- [ ] **Step 3: 更新文档索引**

`docs/README.md` 增加：

- `specs/2026-11-17-m1-daemon-runtime-design.md`
- `contracts/M1-daemon-runtime.contract.md`
- `plans/2026-11-17-m1-daemon-runtime.md`

- [ ] **Step 4: 全量校验**

```bash
pnpm install
pnpm verify
pnpm verify:full
pnpm pack:check
pnpm docker:smoke
git diff --name-only main...HEAD -- apps/web   # 必须为空
```

Expected：全部退出码 0；`apps/web` 空 diff；daemon 测试 < 30 秒。

- [ ] **Step 5: 更新执行记录**

在本文末尾的“执行记录”表追加每个 Task 的 commit、测试数量与偏离说明。

- [ ] **Step 6: Commit**

```bash
git add apps/daemon docs THIRD_PARTY_NOTICES.md pnpm-lock.yaml
git commit -m "test(daemon): 增加 M1-5 闭环验收并完成全量校验"
```

---

## Self-Review

**1. Spec coverage**

- spec 4.1–4.5 → Task 2；5.1–5.5 → Tasks 3–5；5.6–5.7 → Tasks 5–6；5.8–5.10 → Task 7；第 6 节 → Task 1；第 7 节 → Tasks 4–8。
- contract 1–25 条均有对应 Task 与测试；Task 8 负责端到端与命令验收。

**2. Placeholder scan**

- 无 `TODO`/`TBD`/“类似 Task N”；每个 Task 都有可执行测试与文件路径。
- `execa`/`pino` 版本在实施时以 registry 为准；不把版本号当事实。

**3. Type consistency**

- `RuntimeDeps`、`ActiveRun`、`TransitionOutcome` 只在 daemon 内使用，不污染 protocol。
- `EventStore` 的 `appendWs` 接受事务句柄；`appendSessionEvent` 自己开事务；调用方不嵌套事务。
- `EffectPlan` 的 `events` 顺序与 `effects` 顺序一致；`emitTaskStatus` 最后。
- `runningCount` 在 `applyTransition` 与 scheduler 中都按 `running + waiting_input + verifying` 计算。

**4. Boundary check**

- `apps/web` 无改动；`packages/core`/`packages/adapters` 行为不变。
- `apps/daemon` 依赖 `@baton/core`/`@baton/adapters`，但 tsup 的 `noExternal` 覆盖它们。
- 不引入 `p-queue`/`simple-git`；`execa`/`pino` 均 MIT。

---

## 执行记录

| 日期 | Task | 结果 | Commit | 备注 |
|---|---|---|---|---|
| 2026-11-17 | Task 1 | 待执行 | - | - |
| 2026-11-17 | Task 2 | 待执行 | - | - |
| 2026-11-17 | Task 3 | 待执行 | - | - |
| 2026-11-17 | Task 4 | 待执行 | - | - |
| 2026-11-17 | Task 5 | 待执行 | - | - |
| 2026-11-17 | Task 6 | 待执行 | - | - |
| 2026-11-17 | Task 7 | 待执行 | - | - |
| 2026-11-17 | Task 8 | 待执行 | - | - |
