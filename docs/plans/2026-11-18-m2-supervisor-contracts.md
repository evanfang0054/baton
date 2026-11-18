---
spec_ref: ../specs/2026-11-18-m2-supervisor-design.md
spec_topic: m2-supervisor-v0
task_count: 4
estimated_phases: [tests, implementation, verification]
dod: "protocol 词汇与 supervisor.send/事件、core 状态投影与 policy/origin、migration 0006、TaskDetail.origin 完成；pnpm verify 全绿"
depends_on: []
status: active
---

# M2-1 总管 Router v0：契约层实施计划（Plan 1/4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`（推荐）或 `executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选。

**Goal:** 先把协议、core 纯函数、migration 0006 与 `TaskDetail.origin` 落定，让 daemon/web 后续只消费稳定类型。

**Architecture:** `packages/protocol` 定义完整总管词汇与命令/事件；`packages/core` 放 7 列投影、policy 版本与 `TaskOrigin` 组装；`apps/daemon` 只加 migration 与仓储参数，不实现总管服务。

**Tech Stack:** TypeScript ESM、zod 4、Drizzle ORM、vitest。

---

## 计划地图

| Plan | 范围 | 状态 |
|---|---|---|
| **1. 契约层（本计划）** | protocol / core / migration / TaskDetail.origin | 实施中 |
| 2. daemon | config / store / tools / engine / service / WS / REST | 依赖 1 |
| 3. web | RightPanel / SupervisorPanel / stream / composer | 依赖 2 |
| 4. 验收 | Playwright / ego-lite / 证据 / 全量验证 | 依赖 3 |

**GDD:** 按仓库先例显式跳过；测试设计由 contract 14 条 DoD 与任务内测试承担。

**Commit strategy:** 每个 Task 结束提交一次；Task 4 跑 `pnpm verify`。

---

## Task 1: Protocol 词汇、命令与事件

Blocking: none
Slice type: tracer-bullet
Seam: `packages/protocol/src/index.ts` 导出 `SupervisorSendInput` 与 `SupervisorMessageEvent`

**Files：**

- Create: `packages/protocol/src/supervisor.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/commands.ts`
- Modify: `packages/protocol/src/events.ts`
- Modify: `packages/protocol/src/entities/task.ts`
- Modify: `packages/protocol/src/api.ts`
- Create: `packages/protocol/test/supervisor.test.ts`
- Modify: `packages/protocol/test/exports.test.ts`

**Interfaces：**

- Produces: `SupervisorSendInput`、`SupervisorDecision`、`SupervisorMessage`、`TaskOrigin`、`SupervisorStatusResponse`、`SupervisorMessagesResponse`；`ClientMessage` 增加 `supervisor.send`；`ServerMessage` 增加 `supervisor.delta/tool/message`；`TaskDetail.origin`；`TaskDetailResponse.originInvalid`。

- [ ] **Step 1: 写失败测试**

`packages/protocol/test/supervisor.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  ClientMessage,
  ServerMessage,
  SupervisorSendInput,
  TaskDetail,
  TaskOrigin,
} from '../src/index.js'

const actor = { id: 'local-user', kind: 'human', source: 'supervisor-chat' } as const

describe('supervisor protocol', () => {
  it('parses supervisor.send and rejects client-forged host fields', () => {
    const command = ClientMessage.parse({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'supervisor.send',
      payload: {
        workspaceId: 'w1',
        requestId: 'r1',
        text: '给这个 Agent 建个任务',
        contextNodeIds: ['n1'],
        targetNodeId: 'a1',
      },
    })
    expect(command.type).toBe('supervisor.send')

    const forged = SupervisorSendInput.safeParse({
      workspaceId: 'w1',
      requestId: 'r1',
      text: 'x',
      source: 'github',
      actor,
    })
    expect(forged.success).toBe(false)
  })

  it('parses supervisor events without seq', () => {
    const delta = ServerMessage.parse({
      v: 1,
      ts: 1,
      type: 'supervisor.delta',
      payload: { threadId: 'th1', messageId: 'm1', delta: '正在' },
    })
    expect(delta.type).toBe('supervisor.delta')

    const message = ServerMessage.parse({
      v: 1,
      ts: 1,
      type: 'supervisor.message',
      payload: {
        threadId: 'th1',
        messageId: 'm1',
        role: 'assistant',
        content: '已建到待办',
        status: 'ok',
        toolCalls: [],
        createdAt: 1,
        decision: {
          id: 'd1',
          threadId: 'th1',
          triggerId: 'r1',
          messageId: 'm1',
          kind: 'create_task',
          strength: 'explicit',
          mode: 'explicit',
          reason: 'user asked',
          taskId: 't1',
          toolCalls: [],
          createdAt: 1,
        },
      },
    })
    expect(message.type).toBe('supervisor.message')
  })

  it('keeps TaskDetail.origin optional and TaskOrigin strict', () => {
    const origin = TaskOrigin.parse({
      source: 'supervisor-chat',
      triggerId: 'r1',
      threadId: 'th1',
      actor,
      workspaceId: 'w1',
      targetNodeId: 'a1',
      contextNodeIds: ['n1'],
      policyVersion: 'p1',
      promptVersion: 'v1',
      createdAt: 1,
    })
    expect(origin.actor.source).toBe('supervisor-chat')

    const task = TaskDetail.parse({
      id: 't1',
      workspaceId: 'w1',
      nodeId: 'a1',
      title: 'demo',
      prompt: '<task>x</task>',
      status: 'todo',
      waitingReason: null,
      engine: 'fake',
      workspaceMode: 'main',
      branch: null,
      worktreePath: null,
      verifyCommand: null,
      retryCount: 0,
      dangerouslySkipPermissions: false,
      createdAt: 1,
      updatedAt: 1,
      context: null,
    })
    expect(task.origin).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/protocol test -- supervisor`
Expected: FAIL，`SupervisorSendInput` 等导出不存在。

- [ ] **Step 3: 实现协议**

`packages/protocol/src/supervisor.ts` 按 spec §4.2 实现全部 schema；关键片段：

```ts
export const SourceKind = z.enum(['supervisor-chat', 'canvas', 'github', 'feishu'])
export const Actor = z.object({
  id: z.string().min(1),
  kind: z.enum(['human', 'bot', 'system']),
  source: SourceKind,
  displayName: z.string().optional(),
})
export const Strength = z.enum(['explicit', 'inferred'])
export const SupervisorMode = z.enum(['explicit', 'observe', 'auto'])
export const DecisionKind = z.enum(['create_task', 'query_status', 'chat', 'error'])
export const ToolCallRecord = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  args: z.unknown(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
})
export const SupervisorSendInput = z.object({
  workspaceId: Id,
  threadId: Id.optional(),
  requestId: Id,
  text: z.string().min(1).max(8000),
  contextNodeIds: z.array(Id).max(40).default([]),
  targetNodeId: Id.optional(),
})
export const SupervisorDecision = z.object({
  id: Id,
  threadId: Id,
  triggerId: Id,
  messageId: Id,
  kind: DecisionKind,
  strength: Strength,
  mode: SupervisorMode,
  reason: z.string(),
  taskId: Id.nullable(),
  toolCalls: z.array(ToolCallRecord),
  createdAt: Timestamp,
})
export const SupervisorMessage = z.object({
  id: Id,
  threadId: Id,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  toolCalls: z.array(ToolCallRecord).default([]),
  decision: SupervisorDecision.nullable().default(null),
  meta: z
    .object({ contextNodeIds: z.array(Id), targetNodeId: Id.nullable() })
    .nullable()
    .default(null),
  status: z.enum(['ok', 'error']).default('ok'),
  error: AppError.nullable().default(null),
  createdAt: Timestamp,
})
export const TaskOrigin = z.object({
  source: SourceKind,
  triggerId: Id,
  threadId: Id,
  actor: Actor,
  workspaceId: Id,
  targetNodeId: Id,
  contextNodeIds: z.array(Id).max(40),
  policyVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  createdAt: Timestamp,
})
export const SupervisorStatusResponse = z.object({
  configured: z.boolean(),
  model: z.string().optional(),
  mode: SupervisorMode,
  policyVersion: z.string(),
  errorCode: z.string().optional(),
})
export const SupervisorMessagesResponse = z.object({
  threadId: Id.nullable(),
  messages: z.array(SupervisorMessage),
  nextBefore: Id.optional(),
})
```

`commands.ts` 增加：

```ts
CommandBase.extend({ type: z.literal('supervisor.send'), payload: SupervisorSendInput }),
```

`events.ts` 增加三个 `EventBase.extend` 事件并按 spec §5.2 加入 `ServerMessage`。`entities/task.ts`：

```ts
export const TaskDetail = Task.extend({
  context: ContextSnapshot.nullable().default(null),
  origin: TaskOrigin.nullable().default(null),
})
```

`api.ts` 的 `TaskDetailResponse` 增加 `originInvalid: z.boolean().default(false)`。`index.ts` 导出 `./supervisor.js`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/protocol test -- supervisor && pnpm --filter @baton/protocol typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src packages/protocol/test
git commit -m "feat(protocol): 总管词汇与 supervisor 命令事件"
```

---

## Task 2: core 状态投影、policy 与 origin

Blocking: Task 1
Slice type: tracer-bullet
Seam: `packages/core/src/index.ts` 导出 `boardColumn` / `needsPerson` / `buildTaskOrigin`

**Files：**

- Create: `packages/core/src/tasks/board.ts`
- Create: `packages/core/src/supervisor/policy.ts`
- Create: `packages/core/src/supervisor/origin.ts`
- Create: `packages/core/src/supervisor/index.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/tasks-board.test.ts`
- Create: `packages/core/test/supervisor-policy.test.ts`

**Interfaces：**

- Produces: `boardColumn(status)`、`needsPerson({status, attention})`、`waitingSinceFor(task)`、`SUPERVISOR_POLICY`、`supervisorPolicyVersion(policy)`、`buildTaskOrigin(input)`。

- [ ] **Step 1: 写失败测试**

`packages/core/test/tasks-board.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { boardColumn, needsPerson, waitingSinceFor } from '../src/tasks/board.js'

describe('board projection', () => {
  it('maps 9 internal states to 7 columns', () => {
    expect(boardColumn('todo')).toBe('todo')
    expect(boardColumn('queued')).toBe('todo')
    expect(boardColumn('running')).toBe('running')
    expect(boardColumn('verifying')).toBe('running')
    expect(boardColumn('waiting_input')).toBe('waiting')
    expect(boardColumn('review')).toBe('review')
    expect(boardColumn('done')).toBe('done')
    expect(boardColumn('cancelled')).toBe('closed')
    expect(boardColumn('failed')).toBe('closed')
  })

  it('marks a person as needed for attention and gate states', () => {
    expect(needsPerson({ status: 'waiting_input', attention: 'needs_approval' })).toBe(true)
    expect(needsPerson({ status: 'review', attention: 'needs_review' })).toBe(true)
    expect(needsPerson({ status: 'running', attention: 'none' })).toBe(false)
  })

  it('derives waitingSince only for waiting/review', () => {
    expect(waitingSinceFor({ status: 'waiting_input', updatedAt: 5 } as never)).toBe(5)
    expect(waitingSinceFor({ status: 'review', updatedAt: 6 } as never)).toBe(6)
    expect(waitingSinceFor({ status: 'running', updatedAt: 7 } as never)).toBeNull()
  })
})
```

`packages/core/test/supervisor-policy.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { SUPERVISOR_POLICY, supervisorPolicyVersion } from '../src/supervisor/policy.js'
import { buildTaskOrigin } from '../src/supervisor/origin.js'

describe('supervisor policy', () => {
  it('locks the v0 tool whitelist and explicit mode', () => {
    expect(SUPERVISOR_POLICY.mode).toBe('explicit')
    expect(SUPERVISOR_POLICY.allowedTools).toEqual(['list_tasks', 'get_task', 'create_task'])
    expect(supervisorPolicyVersion(SUPERVISOR_POLICY, 'v1')).toMatch(/^[a-f0-9]{12}$/)
  })

  it('builds an immutable task origin from trusted host fields', () => {
    const origin = buildTaskOrigin({
      source: 'supervisor-chat',
      triggerId: 'r1',
      threadId: 'th1',
      workspaceId: 'w1',
      targetNodeId: 'a1',
      contextNodeIds: ['n1'],
      policyVersion: 'p1',
      promptVersion: 'v1',
      createdAt: 1,
    })
    expect(origin.actor).toEqual({
      id: 'local-user',
      kind: 'human',
      source: 'supervisor-chat',
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/core test -- tasks-board supervisor-policy`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

`packages/core/src/tasks/board.ts`：

```ts
import type { Attention, TaskStatus } from '@baton/protocol'

export type BoardColumnId =
  | 'unplanned'
  | 'todo'
  | 'running'
  | 'waiting'
  | 'review'
  | 'done'
  | 'closed'

export function boardColumn(status: TaskStatus): BoardColumnId {
  switch (status) {
    case 'todo':
    case 'queued':
      return 'todo'
    case 'running':
    case 'verifying':
      return 'running'
    case 'waiting_input':
      return 'waiting'
    case 'review':
      return 'review'
    case 'done':
      return 'done'
    case 'cancelled':
    case 'failed':
      return 'closed'
  }
}

export function needsPerson(input: { status: TaskStatus; attention: Attention }): boolean {
  return (
    input.attention !== 'none' ||
    input.status === 'waiting_input' ||
    input.status === 'review'
  )
}

export function waitingSinceFor(task: { status: TaskStatus; updatedAt: number }): number | null {
  return task.status === 'waiting_input' || task.status === 'review' ? task.updatedAt : null
}
```

`packages/core/src/supervisor/policy.ts`：

```ts
import { createHash } from 'node:crypto'

export interface SupervisorPolicy {
  mode: 'explicit' | 'observe' | 'auto'
  allowedTools: readonly string[]
  maxSteps: number
  timeoutMs: number
  maxOutputTokens: number
}

const base = {
  mode: 'explicit' as const,
  allowedTools: ['list_tasks', 'get_task', 'create_task'] as const,
  maxSteps: 4,
  timeoutMs: 60_000,
  maxOutputTokens: 2000,
}

export const SUPERVISOR_POLICY: SupervisorPolicy = base

function sha(value: unknown, salt: string): string {
  return createHash('sha256').update(`${salt}:${JSON.stringify(value)}`).digest('hex').slice(0, 12)
}

export function supervisorPolicyVersion(policy: SupervisorPolicy, promptVersion: string): string {
  return sha({ ...policy, promptVersion }, 'policy')
}
```

> `promptVersion` 由 `apps/daemon/src/supervisor/prompt.ts` 的 `PROMPT_VERSION` 传入，避免 core 依赖 daemon。

`packages/core/src/supervisor/origin.ts`：

```ts
import type { TaskOrigin } from '@baton/protocol'

export interface BuildTaskOriginInput {
  source: TaskOrigin['source']
  triggerId: string
  threadId: string
  workspaceId: string
  targetNodeId: string
  contextNodeIds: string[]
  policyVersion: string
  promptVersion: string
  createdAt: number
}

export function buildTaskOrigin(input: BuildTaskOriginInput): TaskOrigin {
  return {
    ...input,
    actor: { id: 'local-user', kind: 'human', source: input.source },
  }
}
```

`packages/core/src/supervisor/index.ts` re-export policy/origin；`packages/core/src/index.ts` 增加 `export * from './tasks/board.js'` 与 `export * from './supervisor/index.js'`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/core test -- tasks-board supervisor-policy && pnpm --filter @baton/core typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src packages/core/test
git commit -m "feat(core): 总管状态投影与 origin 组装"
```

---

## Task 3: migration 0006 与仓储 origin

Blocking: Task 1
Slice type: tracer-bullet
Seam: `apps/daemon/migrations/0006_*.sql` 含三张表与 `task.origin_json`

**Files：**

- Modify: `apps/daemon/src/db/schema.ts`
- Create: `apps/daemon/migrations/0006_supervisor_v0.sql`（drizzle-kit 生成后重命名/校对）
- Modify: `apps/daemon/src/db/repositories.ts`
- Modify: `apps/daemon/test/migrate.test.ts`（或新建 `apps/daemon/test/migration-0006.test.ts`）

**Interfaces：**

- Produces: `insertTask(tx, input, contextJson?, originJson?)`；`task.origin_json`；`supervisor_thread/message/decision` 表。

- [ ] **Step 1: 写失败测试**

`apps/daemon/test/migration-0006.test.ts`：

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDb, openDb } from '../src/db/index.js'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

describe('migration 0006', () => {
  it('adds origin_json and supervisor tables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-m6-'))
    dirs.push(dir)
    const db = openDb(join(dir, 'test.db'))
    migrateDb(db)

    const columns = db.prepare('PRAGMA table_info(task)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toContain('origin_json')

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>
    const names = tables.map((row) => row.name)
    expect(names).toEqual(
      expect.arrayContaining(['supervisor_thread', 'supervisor_message', 'supervisor_decision']),
    )

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all() as Array<{ name: string }>
    expect(indexes.map((row) => row.name)).toEqual(
      expect.arrayContaining(['supervisor_message_trigger_idx', 'supervisor_decision_trigger_idx']),
    )
    db.close()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- migration-0006`
Expected: FAIL，`origin_json`/表不存在。

- [ ] **Step 3: 改 schema 并生成 migration**

`apps/daemon/src/db/schema.ts`：

- `task` 增加 `originJson: text('origin_json')`。
- 新增 `supervisorThread`、`supervisorMessage`、`supervisorDecision`，字段与索引按 spec §6.2。
- `supervisorMessage` 与 `supervisorDecision` 的 `triggerId` 用 `uniqueIndex(...).on(t.threadId, t.triggerId)`。

Run:

```bash
cd apps/daemon
pnpm exec drizzle-kit generate --name supervisor_v0
```

打开生成的 `migrations/0006_*.sql`，核对：

- `ALTER TABLE task ADD origin_json text;`
- 三张表
- `(thread_id, trigger_id)` 唯一索引
- `(thread_id, created_at)` 索引

若 drizzle 没有生成复合唯一索引，手工补 SQL 并更新 `migrations/meta/_journal.json`/snapshot；以 `migrateDb` 实际执行为准。

- [ ] **Step 4: 改 `insertTask` 并跑测试**

`apps/daemon/src/db/repositories.ts`：

```ts
export function insertTask(
  tx: Tx,
  input: Task,
  contextJson: string | null = null,
  originJson: string | null = null,
): void {
  tx.insert(task)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      nodeId: input.nodeId,
      title: input.title,
      prompt: input.prompt,
      status: input.status,
      waitingReason: input.waitingReason,
      engine: input.engine,
      workspaceMode: input.workspaceMode,
      branch: input.branch,
      worktreePath: input.worktreePath,
      verifyCommand: input.verifyCommand,
      retryCount: input.retryCount,
      dangerouslySkipPermissions: input.dangerouslySkipPermissions,
      contextJson,
      originJson,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .run()
}
```

Run: `pnpm --filter @evanfang0054/baton test -- migration-0006 repositories`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/db apps/daemon/migrations apps/daemon/test
git commit -m "feat(daemon): migration 0006 与任务 origin 字段"
```

---

## Task 4: TaskDetail.origin 读取与 HTTP 降级

Blocking: Task 1、Task 3
Slice type: tracer-bullet
Seam: `GET /api/tasks/:id` 返回 `origin` 与 `originInvalid`

**Files：**

- Modify: `apps/daemon/src/db/repositories.ts`
- Modify: `apps/daemon/src/http/tasks.ts`
- Create: `apps/daemon/test/task-origin.test.ts`

**Interfaces：**

- Produces: `getTaskDetail` 返回 `{ task, contextInvalid, originInvalid }`；`TaskDetailResponse.task.origin`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { TaskOrigin } from '@baton/protocol'
import { getTaskDetail } from '../src/db/repositories.js'
import { createTestDb, seedTask } from './helpers/db.js'

describe('task origin', () => {
  it('returns null for old tasks', () => {
    const database = createTestDb()
    const seeded = seedTask(database.raw)
    const detail = getTaskDetail(database.db, seeded.taskId)
    expect(detail?.task.origin).toBeNull()
    expect(detail?.originInvalid).toBe(false)
  })

  it('parses a valid origin and degrades on invalid json', () => {
    const database = createTestDb()
    const seeded = seedTask(database.raw)
    const origin = TaskOrigin.parse({
      source: 'supervisor-chat',
      triggerId: 'r1',
      threadId: 'th1',
      actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
      workspaceId: seeded.workspaceId,
      targetNodeId: seeded.nodeId,
      contextNodeIds: [],
      policyVersion: 'p1',
      promptVersion: 'v1',
      createdAt: 1,
    })
    database.raw
      .prepare('UPDATE task SET origin_json = ? WHERE id = ?')
      .run(JSON.stringify(origin), seeded.taskId)
    expect(getTaskDetail(database.db, seeded.taskId)?.task.origin?.triggerId).toBe('r1')

    database.raw
      .prepare('UPDATE task SET origin_json = ? WHERE id = ?')
      .run('{bad json', seeded.taskId)
    const invalid = getTaskDetail(database.db, seeded.taskId)
    expect(invalid?.task.origin).toBeNull()
    expect(invalid?.originInvalid).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- task-origin`
Expected: FAIL，`origin`/`originInvalid` 不存在。

- [ ] **Step 3: 实现读取与路由**

`getTaskDetail` 解析 `origin_json`：

```ts
function parseOrigin(raw: string | null): { origin: TaskOrigin | null; invalid: boolean } {
  if (!raw) return { origin: null, invalid: false }
  try {
    const parsed = TaskOrigin.safeParse(JSON.parse(raw))
    return parsed.success ? { origin: parsed.data, invalid: false } : { origin: null, invalid: true }
  } catch {
    return { origin: null, invalid: true }
  }
}
```

返回 `task: { ...task, origin }`、`originInvalid`。`http/tasks.ts` 的 `TaskDetailResponse.parse` 增加 `originInvalid: detail.originInvalid`，并在 invalid 时 `logger.warn({ event: 'task_origin_invalid', taskId })`。

- [ ] **Step 4: 运行测试与全量校验**

Run:

```bash
pnpm --filter @evanfang0054/baton test -- task-origin
pnpm verify
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src apps/daemon/test
git commit -m "feat(daemon): 任务详情返回 origin 并降级坏快照"
```

---

## 完成记录（待填）

- 日期：
- 关键 commit：
- `pnpm verify` 结果：
- 偏离与坑：
