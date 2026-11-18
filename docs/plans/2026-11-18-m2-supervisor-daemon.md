---
spec_ref: ../specs/2026-11-18-m2-supervisor-design.md
spec_topic: m2-supervisor-v0
task_count: 5
estimated_phases: [tests, implementation, verification]
dod: "config/status、store 幂等、三工具、SupervisorEngine、turn 生命周期、WS 广播、历史 REST 完成；daemon 集成测试全绿"
depends_on: [2026-11-18-m2-supervisor-contracts.md]
status: completed
---

# M2-1 总管 Router v0：daemon 实施计划（Plan 2/4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`（推荐）或 `executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选。

**Goal:** 在 daemon 内实现总管服务：配置、持久化、三工具、LLM 端口、turn 生命周期、WS 广播与历史 REST；不碰 web。

**Architecture:** `apps/daemon/src/supervisor/*` 是唯一有副作用的层；工具通过 `ToolContext` 接收 host 注入字段；`SupervisorEngine` 端口隔离 AI SDK；runtime 只做命令分发与广播；历史走只读 REST。

**Tech Stack:** Fastify、`ws`、Drizzle、`ai` 7 + `@ai-sdk/openai-compatible`、vitest。

---

## Task 1: 配置加载与 `/api/supervisor/status`

Blocking: Plan 1
Slice type: tracer-bullet
Seam: `GET /api/supervisor/status` 不泄露 apiKey/baseUrl

**Files：**

- Create: `apps/daemon/src/supervisor/config.ts`
- Create: `apps/daemon/src/http/supervisor.ts`
- Modify: `apps/daemon/src/app.ts`
- Create: `apps/daemon/test/supervisor-config.test.ts`

**Interfaces：**

- Produces: `loadSupervisorConfig(dataDir)`、`registerSupervisorRoutes(app, deps)`（先只注册 status）。

- [ ] **Step 1: 写失败测试**

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { loadSupervisorConfig } from '../src/supervisor/config.js'
import { registerSupervisorRoutes } from '../src/http/supervisor.js'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-sup-'))
  dirs.push(dir)
  return dir
}

describe('supervisor config', () => {
  it('loads a valid config and reports missing/invalid', () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'supervisor.json'),
      JSON.stringify({ baseUrl: 'https://example.com/v1', apiKey: 'sk-test', model: 'demo' }),
    )
    expect(loadSupervisorConfig(dir)).toMatchObject({ ok: true, config: { model: 'demo' } })
    expect(loadSupervisorConfig(tempDir())).toMatchObject({ ok: false, code: 'supervisor_unavailable' })
  })

  it('status never returns apiKey/baseUrl', async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'supervisor.json'),
      JSON.stringify({ baseUrl: 'https://example.com/v1', apiKey: 'sk-test', model: 'demo' }),
    )
    const app = Fastify()
    registerSupervisorRoutes(app, { dataDir: dir, policyVersion: 'p1' })
    const res = await app.inject({ method: 'GET', url: '/api/supervisor/status' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      configured: true,
      model: 'demo',
      mode: 'explicit',
      policyVersion: 'p1',
    })
    expect(res.body).not.toContain('sk-test')
    expect(res.body).not.toContain('example.com')
    await app.close()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-config`
Expected: FAIL，模块/路由不存在。

- [ ] **Step 3: 实现**

`config.ts`：

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export interface SupervisorConfig {
  baseUrl: string
  apiKey: string
  model: string
}

const Schema = z
  .object({
    baseUrl: z.string().url(),
    apiKey: z.string().min(1),
    model: z.string().min(1),
  })
  .strict()

export type LoadSupervisorConfigResult =
  | { ok: true; config: SupervisorConfig }
  | { ok: false; code: 'supervisor_unavailable'; message: string }

export function loadSupervisorConfig(dataDir: string): LoadSupervisorConfigResult {
  try {
    const raw = readFileSync(join(dataDir, 'supervisor.json'), 'utf8')
    const parsed = Schema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      return { ok: false, code: 'supervisor_unavailable', message: 'invalid supervisor config' }
    }
    return { ok: true, config: parsed.data }
  } catch {
    return { ok: false, code: 'supervisor_unavailable', message: 'supervisor config missing' }
  }
}
```

`http/supervisor.ts`：

```ts
import { SUPERVISOR_POLICY } from '@baton/core'
import type { FastifyInstance } from 'fastify'
import { loadSupervisorConfig } from '../supervisor/config.js'

export interface SupervisorRouteDeps {
  dataDir: string
  policyVersion: string
}

export function registerSupervisorRoutes(app: FastifyInstance, deps: SupervisorRouteDeps): void {
  app.get('/api/supervisor/status', async () => {
    const loaded = loadSupervisorConfig(deps.dataDir)
    return loaded.ok
      ? {
          configured: true,
          model: loaded.config.model,
          mode: SUPERVISOR_POLICY.mode,
          policyVersion: deps.policyVersion,
        }
      : {
          configured: false,
          mode: SUPERVISOR_POLICY.mode,
          policyVersion: deps.policyVersion,
          errorCode: loaded.code,
        }
  })
}
```

`app.ts` 注册：

```ts
registerSupervisorRoutes(app, {
  dataDir: config.dataDir,
  policyVersion: 'm2-1-v0',
})
```

`PROMPT_VERSION` 在 Task 4 的 `prompt.ts` 提供；本任务先用字面量 `'m2-1-v0'`，Task 4 改为 `supervisorPolicyVersion(SUPERVISOR_POLICY, PROMPT_VERSION)`。

- [ ] **Step 4: 跑测试与类型检查**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-config && pnpm --filter @evanfang0054/baton typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/supervisor/config.ts apps/daemon/src/http/supervisor.ts apps/daemon/src/app.ts apps/daemon/test/supervisor-config.test.ts
git commit -m "feat(daemon): 总管配置与状态接口"
```

---

## Task 2: supervisor store 与幂等

Blocking: Task 1、Plan 1 Task 3
Slice type: tracer-bullet
Seam: 同一 `(thread_id, trigger_id)` 只落一条 user message / 一个 decision

**Files：**

- Create: `apps/daemon/src/supervisor/store.ts`
- Create: `apps/daemon/test/supervisor-store.test.ts`

**Interfaces：**

- Produces: `createSupervisorStore({db, now, newId})`，方法 `getOrCreateThread`、`findLatestThread`、`insertUserMessage`、`insertAssistantTurn`、`listMessages`、`getDecisionByTrigger`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { createSupervisorStore } from '../src/supervisor/store.js'
import { createTestDb } from './helpers/db.js'

function store() {
  const database = createTestDb()
  const ids = ['th1', 'm1', 'd1', 'm2', 'd2']
  let index = 0
  return {
    database,
    value: createSupervisorStore({
      db: database.db,
      now: () => 10,
      newId: () => ids[index++]!,
    }),
  }
}

describe('supervisor store', () => {
  it('creates one thread per workspace and dedupes trigger', () => {
    const { value } = store()
    const thread = value.getOrCreateThread('w1')
    expect(thread.id).toBe('th1')
    expect(value.getOrCreateThread('w1').id).toBe('th1')

    const first = value.insertUserMessage({
      threadId: thread.id,
      triggerId: 'r1',
      text: '建任务',
      meta: { contextNodeIds: ['n1'], targetNodeId: 'a1' },
    })
    const duplicate = value.insertUserMessage({
      threadId: thread.id,
      triggerId: 'r1',
      text: '建任务',
      meta: { contextNodeIds: ['n1'], targetNodeId: 'a1' },
    })
    expect(duplicate.duplicate).toBe(true)
    expect(duplicate.message.id).toBe(first.message.id)
  })

  it('lists messages ascending with decision', () => {
    const { value } = store()
    const thread = value.getOrCreateThread('w1')
    const user = value.insertUserMessage({
      threadId: thread.id,
      triggerId: 'r1',
      text: '建任务',
      meta: null,
    })
    value.insertAssistantTurn({
      threadId: thread.id,
      content: '好的',
      toolCalls: [],
      status: 'ok',
      error: null,
      decision: {
        id: 'd1',
        threadId: thread.id,
        triggerId: 'r1',
        messageId: user.message.id,
        kind: 'chat',
        strength: 'explicit',
        mode: 'explicit',
        reason: 'test',
        taskId: null,
        toolCalls: [],
        createdAt: 10,
      },
    })
    expect(value.listMessages(thread.id, 10).map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-store`
Expected: FAIL。

- [ ] **Step 3: 实现 store**

- `getOrCreateThread(workspaceId)`：查 `supervisor_thread` 最新一行，没有则插入 `source='supervisor-chat'`。
- `insertUserMessage`：`INSERT ... ON CONFLICT(thread_id, trigger_id) DO NOTHING`；返回 `{message, duplicate}`。SQLite/Drizzle 可用 `insert(...).onConflictDoNothing()` 后按 `(thread_id, trigger_id)` 查回。
- `insertAssistantTurn`：一个事务里插入 assistant message（`trigger_id = NULL`）+ decision；assistant message 的 `tool_calls_json`、`status`、`error_json` 落库。
- `listMessages(threadId, limit, before?)`：按 `created_at, id` 升序；join decision；`before` 用 `created_at <` 或 `id <` 游标，返回 `nextBefore`。
- `getDecisionByTrigger(threadId, triggerId)`：用于重复请求返回已有 task。

字段映射按 spec §6.2；JSON 解析失败时降级为 `null` 并记录 debug 日志。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-store`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/supervisor/store.ts apps/daemon/test/supervisor-store.test.ts
git commit -m "feat(daemon): 总管 thread/message/decision 存储与幂等"
```

---

## Task 3: 三工具与 task-service origin/audit

Blocking: Task 2、Plan 1 Task 3
Slice type: tracer-bullet
Seam: `create_task` 只写 `todo` + origin + audit，不 enqueue

**Files：**

- Modify: `apps/daemon/src/runtime/task-service.ts`
- Create: `apps/daemon/src/supervisor/tools.ts`
- Create: `apps/daemon/test/supervisor-tools.test.ts`

**Interfaces：**

- Produces: `createSupervisorTools({db, taskService, now, newId})` → `SupervisorToolset`；`taskService.createTask(input, {origin, audit})`。

- [ ] **Step 1: 写失败测试**

```ts
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getTask } from '../src/db/repositories.js'
import { createTaskService } from '../src/runtime/task-service.js'
import { createSupervisorTools } from '../src/supervisor/tools.js'
import { createTestDb, seedTask, seedTextNode, type TestDb } from './helpers/db.js'

const dirs: string[] = []
const dbs: TestDb[] = []
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dbs.splice(0).forEach((entry) => entry.raw.close())
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'baton-tools-'))
  dirs.push(root)
  const database = createTestDb()
  dbs.push(database)
  const seeded = seedTask(database.raw, { withSession: false })
  seedTextNode(database.raw, seeded.canvasId, 'text-1', '需求 A')
  mkdirSync(join(root, seeded.relPath), { recursive: true })

  const taskService = createTaskService({
    db: database.db,
    config: {
      host: '127.0.0.1',
      port: 0,
      token: null,
      dataDir: root,
      webRoot: root,
      workspacesRoot: root,
      maxConcurrency: 1,
      maxLiveSessions: 5,
      claudeMaxTurns: 30,
      claudeMaxBudgetUsd: 2,
      claudeProjectHooks: 'on',
      allowBypassPermissions: false,
      killSwitch: false,
    },
    now: () => 10,
    newId: () => 'task-new',
  })
  const tools = createSupervisorTools({
    db: database.db,
    taskService,
    now: () => 10,
    newId: () => 'id-new',
  })
  return { database, seeded, tools }
}

const ctx = (seeded: ReturnType<typeof seedTask>) => ({
  workspaceId: seeded.workspaceId,
  threadId: 'th1',
  triggerId: 'r1',
  actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' } as const,
  selection: {
    contextNodeIds: ['text-1'],
    targetNodeId: seeded.nodeId,
    agentCandidates: [{ id: seeded.nodeId, title: 'agent', engine: 'fake' }],
  },
  policyVersion: 'p1',
  promptVersion: 'v1',
  memo: {},
})

describe('supervisor tools', () => {
  it('creates a todo task with origin and audit, never enqueues', async () => {
    const { database, seeded, tools } = setup()
    const result = (await tools.create_task.execute(
      { title: '登录页暗黑模式', targetNodeId: seeded.nodeId, contextNodeIds: ['text-1'] },
      ctx(seeded),
    )) as { taskId: string; status: string }

    expect(result.status).toBe('todo')
    const task = getTask(database.db, 'task-new')
    expect(task?.status).toBe('todo')
    expect(task?.prompt).toContain('<task>')
    expect(database.raw.prepare('select count(*) as n from session').get()).toEqual({ n: 0 })
    expect(database.raw.prepare('select count(*) as n from audit').get()).toEqual({ n: 1 })
  })

  it('rejects context outside the current selection', async () => {
    const { seeded, tools } = setup()
    await expect(
      tools.create_task.execute(
        { title: 'x', targetNodeId: seeded.nodeId, contextNodeIds: ['other'] },
        ctx(seeded),
      ),
    ).rejects.toMatchObject({ code: 'supervisor_context_invalid' })
  })

  it('returns attention tasks and task metadata without transcript', async () => {
    const { database, seeded, tools } = setup()
    database.raw
      .prepare("update task set status='review', updated_at=9 where id=?")
      .run(seeded.taskId)
    const list = (await tools.list_tasks.execute({ filter: 'attention' }, ctx(seeded))) as {
      tasks: Array<{ id: string; status: string; attention: string }>
    }
    expect(list.tasks[0]).toMatchObject({ id: seeded.taskId, status: 'review' })

    const detail = (await tools.get_task.execute({ taskId: seeded.taskId }, ctx(seeded))) as Record<
      string,
      unknown
    >
    expect(detail).not.toHaveProperty('events')
    expect(detail).not.toHaveProperty('transcript')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-tools`
Expected: FAIL。

- [ ] **Step 3: 实现**

`task-service.ts` 增加：

```ts
export interface CreateTaskOptions {
  origin?: TaskOrigin
  audit?: { actor: string; action: string; detail: Record<string, unknown> }
}

export function createTask(input: TaskCreateInput, options: CreateTaskOptions = {}): CreateTaskResult
```

在现有事务里：

```ts
insertTask(
  tx,
  { ...taskInput },
  JSON.stringify(snapshot),
  options.origin ? JSON.stringify(options.origin) : null,
)
if (options.audit) {
  insertAudit(tx, {
    id: deps.newId(),
    ts: now,
    actor: options.audit.actor,
    action: options.audit.action,
    detail: options.audit.detail,
  })
}
```

`tools.ts`：

- `createSupervisorTools` 返回三个工具，参数用 zod：
  - `list_tasks({filter?: 'all'|'attention', limit?: 1..50})`
  - `get_task({taskId})`
  - `create_task({title: 1..80, targetNodeId?: Id, contextNodeIds?: Id[]})`
- `create_task`：
  - 目标解析：入参 > `ctx.selection.targetNodeId` > `agentCandidates` 唯一；否则抛 `supervisor_target_invalid`。
  - 上下文解析：入参或 `ctx.selection.contextNodeIds`；必须是选择子集；排除目标。
  - `taskService.createTask({...}, { origin: buildTaskOrigin({...}), audit: { actor:'supervisor', action:'supervisor.task.create', detail:{...} } })`。
  - 返回 `{ taskId, title, target, contextCount, status:'todo' }`。
- `list_tasks` 用 `listTasks` + `attentionFor` + `boardColumn`/`needsPerson`/`waitingSinceFor`。
- `get_task` 用 `getTaskDetail` + `listSessionsByTask` + `getReviewByTask`；只返回摘要字段。
- 错误用 `appError('supervisor_*', ...)`；工具 handler 抛错由 engine 转成 tool error。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-tools task-service`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/runtime/task-service.ts apps/daemon/src/supervisor/tools.ts apps/daemon/test/supervisor-tools.test.ts
git commit -m "feat(daemon): 总管三工具与任务 origin 审计"
```

---

## Task 4: SupervisorEngine、turn 生命周期与 runtime 接线

Blocking: Task 3
Slice type: tracer-bullet
Seam: `supervisor.send` ack 后异步产生 `delta/tool/message`，重复请求不重跑

**Files：**

- Create: `apps/daemon/src/supervisor/prompt.ts`
- Create: `apps/daemon/src/supervisor/engine.ts`
- Create: `apps/daemon/src/supervisor/service.ts`
- Modify: `apps/daemon/src/ws/hub.ts`
- Modify: `apps/daemon/src/runtime/index.ts`
- Modify: `apps/daemon/src/bootstrap.ts`
- Create: `apps/daemon/test/supervisor-service.test.ts`

**Interfaces：**

- Produces: `SupervisorEngine`、`createAiSdkSupervisorEngine(config)`、`createSupervisorService(deps)`、`WsHub.broadcastRaw(frame)`、`RuntimeDeps.broadcastRaw/supervisorEngine`。

- [ ] **Step 1: 写失败测试**

```ts
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SupervisorEngine } from '../src/supervisor/engine.js'
import { createSupervisorService } from '../src/supervisor/service.js'
import { createTaskService } from '../src/runtime/task-service.js'
import { getTask } from '../src/db/repositories.js'
import { createTestDb, seedTask, seedTextNode, type TestDb } from './helpers/db.js'

const dirs: string[] = []
const dbs: TestDb[] = []
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dbs.splice(0).forEach((entry) => entry.raw.close())
})

function setup(engine: SupervisorEngine) {
  const root = mkdtempSync(join(tmpdir(), 'baton-svc-'))
  dirs.push(root)
  const database = createTestDb()
  dbs.push(database)
  const seeded = seedTask(database.raw)
  seedTextNode(database.raw, seeded.canvasId, 'text-1', '需求 A')
  mkdirSync(join(root, seeded.relPath), { recursive: true })
  writeFileSync(
    join(root, 'supervisor.json'),
    JSON.stringify({ baseUrl: 'https://example.com/v1', apiKey: 'sk-test', model: 'demo' }),
  )
  const frames: string[] = []
  const config = {
    host: '127.0.0.1',
    port: 0,
    token: null,
    dataDir: root,
    webRoot: root,
    workspacesRoot: root,
    maxConcurrency: 1,
    maxLiveSessions: 5,
    claudeMaxTurns: 30,
    claudeMaxBudgetUsd: 2,
    claudeProjectHooks: 'on',
    allowBypassPermissions: false,
    killSwitch: false,
  }
  const taskService = createTaskService({
    db: database.db,
    config,
    now: () => 10,
    newId: () => 'task-new',
  })
  const service = createSupervisorService({
    db: database.db,
    dataDir: root,
    taskService,
    engine,
    now: () => 10,
    newId: (() => {
      let n = 0
      return () => `id-${++n}`
    })(),
    broadcastRaw: (frame: string) => frames.push(frame),
    track: (action: () => void | Promise<void>) => {
      void action()
    },
    logger: { warn() {}, error() {}, info() {} } as never,
  })
  return { database, seeded, service, frames }
}

describe('supervisor service', () => {
  it('acks, streams, creates todo task once, and dedupes', async () => {
    const engine: SupervisorEngine = {
      async run({ onDelta, tools }) {
        onDelta('正在建任务')
        const result = await tools.create_task.execute({
          title: '登录页暗黑模式',
          contextNodeIds: ['text-1'],
        })
        return {
          text: '已建到待办',
          toolCalls: [{ id: 'tc1', name: 'create_task', args: {}, ok: true, result }],
          finishReason: 'stop',
        }
      },
    }
    const { database, seeded, service, frames } = setup(engine)
    const input = {
      workspaceId: seeded.workspaceId,
      requestId: 'r1',
      text: '给这个 Agent 建个任务',
      contextNodeIds: ['text-1'],
      targetNodeId: seeded.nodeId,
    }
    const ack = service.send(input)
    expect(ack.ok).toBe(true)
    await service.waitForIdle()

    expect(frames.some((frame) => frame.includes('supervisor.delta'))).toBe(true)
    expect(frames.some((frame) => frame.includes('supervisor.message'))).toBe(true)
    expect(getTask(database.db, 'task-new')?.status).toBe('todo')

    const duplicate = service.send({ ...input, requestId: 'r1' })
    await service.waitForIdle()
    expect(duplicate.ok).toBe(true)
    // seedTask 已有一条占位任务；重复 requestId 不应再建第二条新任务。
    expect(database.raw.prepare('select count(*) as n from task').get()).toEqual({ n: 2 })
  })

  it('records an error message when the engine throws', async () => {
    const engine: SupervisorEngine = {
      async run() {
        throw new Error('provider down')
      },
    }
    const { database, seeded, service } = setup(engine)
    service.send({
      workspaceId: seeded.workspaceId,
      requestId: 'r2',
      text: '你好',
      contextNodeIds: [],
    })
    await service.waitForIdle()
    const row = database.raw
      .prepare("select status from supervisor_message where role='assistant'")
      .get() as { status: string }
    expect(row.status).toBe('error')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-service`
Expected: FAIL。

- [ ] **Step 3: 实现**

`prompt.ts` 导出 `SUPERVISOR_PROMPT`（按 spec §5.6 的 11 条规则）与 `PROMPT_VERSION = sha256(SUPERVISOR_PROMPT).slice(0,12)`。

`engine.ts`：

```ts
export interface SupervisorEngine {
  run(input: {
    system: string
    messages: SupervisorMessage[]
    tools: BoundToolset
    signal: AbortSignal
    onDelta(text: string): void
  }): Promise<{ text: string; toolCalls: ToolCallRecord[]; finishReason: string }>
}
```

- `createAiSdkSupervisorEngine(config)` 用 `createOpenAICompatible` + `streamText`，`maxSteps=SUPERVISOR_POLICY.maxSteps`、`maxOutputTokens`、`AbortSignal.timeout`；把 `textStream` 逐块 `onDelta`，结束后从 `steps` 收集 toolCalls。
- `BoundToolset` 是 `Record<string, { description; parameters; execute(input): Promise<unknown> }>`；service 用 `bindTools(tools, ctx)` 绑定。
- 测试注入 `SupervisorEngine`，不需要真实 SDK。

`service.ts`：

- `send(input)`：`loadSupervisorConfig` → 失败返回 error；`getOrCreateThread`；`insertUserMessage`；duplicate 检查先于 busy；`activeTurns` 忙则 `supervisor_busy`；ack 后 `track(runTurn)`。
- `runTurn`：构建 candidate card（只含标题）、history、bound tools；`engine.run`；delta 32ms/512 字符批；成功后 `insertAssistantTurn` + 发 `supervisor.message`；失败落 error message + decision；`claim_without_tool` 守卫。
- `waitForIdle()`：测试用，等待 `activeTurns` 清空。
- `close()`：abort 所有 controller。
- 帧构造：`{v:1,id:messageId,type,ts,payload}`，不带 `seq`。

`ws/hub.ts`：

```ts
broadcastRaw(frame: string): void {
  for (const socket of sockets) sendSafely(socket, frame)
}
```

`runtime/index.ts`：

- `RuntimeDeps` 增加 `broadcastRaw?`、`supervisorEngine?`。
- 构造 `createSupervisorService`，传入 `taskService`、`deps.broadcastRaw`、`hooks.track`。
- `handleCommand` 增加 `case 'supervisor.send': return supervisor.send(message.payload)`。
- `close()` 先 `supervisor.close()`。
- `bootstrap` 传 `broadcastRaw: (frame) => hub.broadcastRaw(frame)`。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-service supervisor-store`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/supervisor apps/daemon/src/ws/hub.ts apps/daemon/src/runtime/index.ts apps/daemon/src/bootstrap.ts apps/daemon/test/supervisor-service.test.ts
git commit -m "feat(daemon): 总管 turn 生命周期与 WS 接线"
```

---

## Task 5: 历史 REST 与分页

Blocking: Task 4
Slice type: tracer-bullet
Seam: `GET /api/supervisor/messages` 返回升序消息 + decision + `nextBefore`

**Files：**

- Modify: `apps/daemon/src/http/supervisor.ts`
- Modify: `apps/daemon/test/rest-api.test.ts`（或新建 `supervisor-rest.test.ts`）

**Interfaces：**

- Produces: `GET /api/supervisor/messages?workspaceId=&limit=50&before=`

- [ ] **Step 1: 写失败测试**

```ts
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerSupervisorRoutes } from '../src/http/supervisor.js'
import { createTestDb } from './helpers/db.js'
import { createSupervisorStore } from '../src/supervisor/store.js'

describe('GET /api/supervisor/messages', () => {
  it('returns messages ascending with nextBefore', async () => {
    const database = createTestDb()
    const store = createSupervisorStore({
      db: database.db,
      now: () => 10,
      newId: (() => { let n = 0; return () => `id-${++n}` })(),
    })
    const thread = store.getOrCreateThread('w1')
    store.insertUserMessage({ threadId: thread.id, triggerId: 'r1', text: 'hi', meta: null })

    const app = Fastify()
    registerSupervisorRoutes(app, { dataDir: '/tmp/none', policyVersion: 'p1', store })
    const res = await app.inject({
      method: 'GET',
      url: `/api/supervisor/messages?workspaceId=w1&limit=50`,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { threadId: string; messages: unknown[] }
    expect(body.threadId).toBe(thread.id)
    expect(body.messages).toHaveLength(1)
    await app.close()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-rest`
Expected: FAIL。

- [ ] **Step 3: 实现**

`http/supervisor.ts` 的 deps 增加 `store`，注册：

```ts
const Query = z.object({
  workspaceId: Id,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: Id.optional(),
})

app.get('/api/supervisor/messages', async (req) => {
  const parsed = Query.safeParse(req.query)
  if (!parsed.success) throw appError('invalid_payload', 'invalid query', parsed.error.issues)
  const thread = store.findLatestThread(parsed.data.workspaceId)
  if (!thread) return { threadId: null, messages: [] }
  const page = store.listMessages(thread.id, parsed.data.limit, parsed.data.before)
  return { threadId: thread.id, messages: page.messages, nextBefore: page.nextBefore }
})
```

- [ ] **Step 4: 跑测试与全量校验**

Run:

```bash
pnpm --filter @evanfang0054/baton test -- supervisor-rest
pnpm verify
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/http/supervisor.ts apps/daemon/test
git commit -m "feat(daemon): 总管历史消息接口"
```

---

## 完成记录（2026-11-18）

- **关键 commit**：`233d38d` config/status；`7f49d66` store 幂等；`2fc3b36` 三工具 + origin 审计；`53bb14f` engine/service/WS/历史。
- **验证**：daemon 41 files / 168 tests；`pnpm verify` 退出码 0。
- **实现细节与偏离**：
  - 新增 `ai@7.0.176`、`@ai-sdk/openai-compatible@3.0.93`；THIRD_PARTY_NOTICES 已有 `ai` / `@ai-sdk/*` Apache-2.0 条目。
  - `SupervisorEngine` 使用 AI SDK 7 的 `streamText` + `stopWhen: stepCountIs(4)`；工具通过 `inputSchema` 绑定。
  - `ToolContext` 增加 `text`（用户原话），`create_task` 用它作为任务 prompt；`store.insertAssistantTurn` 增加可选 `messageId`，让流式事件与最终消息同 id。
  - `create_task` 目标/上下文必须是当前选择的子集；未传目标时从选择里的唯一 Agent 推断。
  - `supervisor.send` 已替换 Plan 1 的 `supervisor_not_implemented` 临时接线；重复 `requestId` 先返回已有 ack，再看 busy。
  - `policyVersion` 在 core 用纯 TS 短指纹（不引 Node crypto），与 spec 的 sha256 描述略有偏离；只用于版本标识，不用于安全。
  - 工具错误在 AI SDK 7 的 `toolResults` 里以缺失结果表示，`ToolCallRecord.ok` 以是否有 result 判定；错误文本不进模型上下文之外的日志。
