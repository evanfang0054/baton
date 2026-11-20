---
spec_ref: ../specs/2026-11-20-m5-supervisor-aftersales-design.md
spec_topic: m5-supervisor-aftersales
task_count: 7
estimated_phases: [tests, implementation, verification]
dod: "14 个工具全部接线；售后动作复用 core 转移并可审计；批量从文本节点建任务；提示词与 claim 守卫覆盖新动作；daemon 单元与集成测试通过"
status: active
depends_on: none
---

# M5-1 daemon：总管售后工具与批量实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `agent-harness:subagent-driven-development` (recommended) or `agent-harness:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改 protocol/core/migration 的前提下，把 `retry/reopen/cancel/reply`、搜索/历史、pending 摘要与从文本节点批量建任务接到总管。

**Architecture:** 所有售后动作复用 `applyTransition`；`reply` 复用从 runtime `session.reply` 抽出的 `replyToTask()`；批量复用 `taskService.createTask`，共享一个 Agent；提示词只增加动作规则，不改变 Router 边界。

**Tech Stack:** Node 22 + TypeScript ESM、Fastify、zod 4、better-sqlite3、vitest。

---

## 文件结构

- Modify: `apps/daemon/src/supervisor/tools.ts` — 6 个新工具、2 个工具扩展、批量/ pending 辅助函数。
- Modify: `apps/daemon/src/supervisor/service.ts` — `replyToTask` 依赖、14 工具接线、claim 守卫。
- Modify: `apps/daemon/src/supervisor/prompt.ts` — 14 工具与售后/批量规则。
- Modify: `apps/daemon/src/runtime/index.ts` — 抽出 `replyToTask()` 并传给 supervisor。
- Modify: `apps/daemon/test/supervisor-tools.test.ts` — 新工具单测。
- Modify: `apps/daemon/test/supervisor-engine-mock.test.ts` — 14 工具接线断言。
- Modify: `apps/daemon/test/supervisor-service.test.ts` — claim 守卫与批量集成。

---

### Task 1: `list_tasks` 支持 `q/status`

Blocking: none
Slice type: tracer-bullet
Seam: `tools.list_tasks.execute`

**Files:**
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Test: `apps/daemon/test/supervisor-tools.test.ts`

**Interfaces:**
- Consumes: `listTasks(db, { workspaceId, status? })`
- Produces: `list_tasks({ filter?, status?, q?, limit? })`

- [ ] **Step 1: 写失败测试**

在 `supervisor-tools.test.ts` 的 `describe('supervisor tools')` 中加：

```ts
it('filters tasks by q and status in the current workspace', async () => {
  const { database, seeded, tools } = setup()
  const insert = database.raw.prepare(
    `insert into task (
       id, workspace_id, node_id, title, prompt, status, engine, workspace_mode,
       branch, worktree_path, verify_command, retry_count, created_at, updated_at
     ) values (?, ?, ?, ?, 'p', ?, 'fake', 'main', null, null, null, 0, ?, ?)`,
  )
  insert.run('task-login', seeded.workspaceId, seeded.nodeId, '登录页修复', 'todo', 3, 3)
  insert.run('task-home', seeded.workspaceId, seeded.nodeId, '首页登录入口', 'done', 2, 2)
  insert.run('task-other', seeded.workspaceId, seeded.nodeId, '支付回调', 'todo', 1, 1)

  const byQ = (await tools.list_tasks.execute({ q: '登录' }, ctx(seeded))) as {
    tasks: Array<{ id: string }>
  }
  expect(byQ.tasks.map((task) => task.id)).toEqual(['task-login', 'task-home'])

  const byStatus = (await tools.list_tasks.execute({ status: 'done' }, ctx(seeded))) as {
    tasks: Array<{ id: string }>
  }
  expect(byStatus.tasks.map((task) => task.id)).toEqual(['task-home'])

  const byId = (await tools.list_tasks.execute({ q: 'task-log' }, ctx(seeded))) as {
    tasks: Array<{ id: string }>
  }
  expect(byId.tasks.map((task) => task.id)).toEqual(['task-login'])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-tools.test.ts`
Expected: FAIL，`status` 查询把 done 任务也返回，或 `q` 未生效。

- [ ] **Step 3: 实现**

`tools.ts` 顶部把 `TaskStatus` 改为值导入：

```ts
import { Engine, Node, SupervisorTaskCard, TaskStatus, type Actor /* ... */ } from '@baton/protocol'
```

替换 `listTasksInput`：

```ts
const listTasksInput = z.object({
  filter: z.enum(['all', 'attention']).default('all'),
  status: TaskStatus.optional(),
  q: z.string().trim().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(50).default(20),
})
```

在 `execute` 中：

```ts
const parsed = listTasksInput.parse(input)
const needle = parsed.q?.toLowerCase()
const tasks = listTasks(deps.db, {
  workspaceId: ctx.workspaceId,
  ...(parsed.status ? { status: parsed.status } : {}),
})
  .filter(
    (task) =>
      !needle || task.title.toLowerCase().includes(needle) || task.id.toLowerCase().startsWith(needle),
  )
  .map((task) => taskSummary(task, boardColumn(task.status)))
  // 现有 filter/sort/slice 保持不变
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-tools.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/supervisor/tools.ts apps/daemon/test/supervisor-tools.test.ts
git commit -m "feat(daemon): 总管任务搜索支持 q/status"
```

---

### Task 2: `get_task.pending` 结构化摘要

Blocking: Task 1
Slice type: tracer-bullet
Seam: `tools.get_task.execute`

**Files:**
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Test: `apps/daemon/test/supervisor-tools.test.ts`

**Interfaces:**
- Consumes: `listApprovalsByTask(db, taskId)`；`ApprovalRecord.request`
- Produces: `pending: null | { kind, approval?, question? }`

- [ ] **Step 1: 写失败测试**

```ts
it('returns a sanitized pending approval without raw input', async () => {
  const { database, seeded, tools } = setup()
  database.db.transaction((tx) => {
    insertApproval(tx, {
      id: 'ap1',
      sessionId: seeded.sessionId!,
      requestId: 'req1',
      request: { toolName: 'Bash', input: { command: 'rm -rf /tmp/x' }, risk: 'high' },
    })
  })
  const task = getTask(database.db, seeded.taskId)!
  database.raw
    .prepare('update task set status = ?, waiting_reason = ? where id = ?')
    .run('waiting_input', 'approval', task.id)

  const result = (await tools.get_task.execute({ taskId: task.id }, ctx(seeded))) as {
    pending: { kind: string; approval: { toolName: string; risk: string; reason?: string } }
  }
  expect(result.pending).toEqual({
    kind: 'approval',
    approval: { toolName: 'Bash', risk: 'high' },
  })
  expect(JSON.stringify(result)).not.toContain('rm -rf')
})

it('returns structured AskUserQuestion options', async () => {
  const { database, seeded, tools } = setup()
  database.db.transaction((tx) => {
    insertApproval(tx, {
      id: 'ap2',
      sessionId: seeded.sessionId!,
      requestId: 'req2',
      request: {
        toolName: 'AskUserQuestion',
        input: { questions: [{ question: '用哪个方案？', options: [{ label: 'A' }, { label: 'B' }] }] },
        risk: 'low',
      },
    })
  })
  const task = getTask(database.db, seeded.taskId)!
  database.raw
    .prepare('update task set status = ?, waiting_reason = ? where id = ?')
    .run('waiting_input', 'approval', task.id)

  const result = (await tools.get_task.execute({ taskId: task.id }, ctx(seeded))) as {
    pending: { kind: string; question: { questions: Array<{ question: string; options: Array<{ label: string }> }> } }
  }
  expect(result.pending.kind).toBe('question')
  expect(result.pending.question.questions[0]).toEqual({
    question: '用哪个方案？',
    options: [{ label: 'A' }, { label: 'B' }],
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-tools.test.ts`
Expected: FAIL，`pending` 为 undefined。

- [ ] **Step 3: 实现**

在 `tools.ts` 加：

```ts
const AskUserQuestionInput = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        header: z.string().optional(),
        options: z
          .array(z.object({ label: z.string().min(1), description: z.string().optional() }))
          .optional(),
      }),
    )
    .min(1),
})

function pendingForTask(db: Db, task: Task): unknown {
  if (task.status !== 'waiting_input') return null
  if (task.waitingReason !== 'approval') {
    return task.waitingReason ? { kind: task.waitingReason } : null
  }
  const approval = listApprovalsByTask(db, task.id)
    .filter((item) => item.decision === null)
    .at(-1)
  if (!approval) return { kind: 'approval' }
  const base = {
    kind: 'approval' as const,
    approval: {
      toolName: approval.request.toolName,
      risk: approval.request.risk,
      ...(approval.request.reason ? { reason: approval.request.reason } : {}),
    },
  }
  if (approval.request.toolName !== 'AskUserQuestion') return base
  const parsed = AskUserQuestionInput.safeParse(approval.request.input)
  if (!parsed.success) return base
  return { kind: 'question' as const, question: parsed.data }
}
```

在 `get_task` 返回对象里加 `pending: pendingForTask(deps.db, task)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-tools.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/supervisor/tools.ts apps/daemon/test/supervisor-tools.test.ts
git commit -m "feat(daemon): 总管 get_task 返回结构化 pending"
```

---

### Task 3: `get_task_history`

Blocking: Task 2
Slice type: tracer-bullet
Seam: `tools.get_task_history.execute`

**Files:**
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Test: `apps/daemon/test/supervisor-tools.test.ts`

**Interfaces:**
- Consumes: `listTaskStatusHistory(db, taskId, limit)`、`listSessionsByTask`、`listReviewsByTask`
- Produces: `get_task_history({ taskId, limit? })`

- [ ] **Step 1: 写失败测试**

```ts
it('returns status, session and review summaries without transcript', async () => {
  const { database, seeded, tools } = setup()
  database.raw
    .prepare('insert into ws_event (id, type, payload_json, ts, task_id) values (?, ?, ?, ?, ?)')
    .run('e1', 'task.status', JSON.stringify({ status: 'queued', previousStatus: 'todo' }), 1, seeded.taskId)
  database.raw
    .prepare('insert into ws_event (id, type, payload_json, ts, task_id) values (?, ?, ?, ?, ?)')
    .run('e2', 'session.event', JSON.stringify({ text: 'secret transcript' }), 2, seeded.taskId)

  const result = (await tools.get_task_history.execute({ taskId: seeded.taskId }, ctx(seeded))) as {
    taskId: string
    statusEvents: Array<{ status: string }>
    sessions: unknown[]
    reviews: unknown[]
  }
  expect(result.taskId).toBe(seeded.taskId)
  expect(result.statusEvents).toHaveLength(1)
  expect(result.statusEvents[0]?.status).toBe('queued')
  expect(JSON.stringify(result)).not.toContain('secret transcript')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-tools.test.ts`
Expected: FAIL，`tools.get_task_history` 不存在。

- [ ] **Step 3: 实现**

在 `tools.ts` 导入 `listTaskStatusHistory`、`listReviewsByTask`（`listSessionsByTask` 已导入）。

```ts
const getTaskHistoryInput = z.object({
  taskId: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(20),
})
```

工具实现：

```ts
get_task_history: {
  description: '读取任务状态转移、session 与 review 摘要；不返回 transcript、日志或 diff 正文。',
  parameters: getTaskHistoryInput,
  async execute(input, ctx) {
    const parsed = getTaskHistoryInput.parse(input)
    const detail = getTaskDetail(deps.db, parsed.taskId)
    if (!detail || detail.task.workspaceId !== ctx.workspaceId) {
      throw appError('task_not_found', 'task not found', { taskId: parsed.taskId })
    }
    const history = listTaskStatusHistory(deps.db, parsed.taskId, parsed.limit)
    return {
      taskId: parsed.taskId,
      statusEvents: history.items,
      sessions: listSessionsByTask(deps.db, parsed.taskId),
      reviews: listReviewsByTask(deps.db, parsed.taskId),
      ...(history.nextBeforeOrdinal !== undefined
        ? { nextBeforeOrdinal: history.nextBeforeOrdinal }
        : {}),
    }
  },
},
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-tools.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/supervisor/tools.ts apps/daemon/test/supervisor-tools.test.ts
git commit -m "feat(daemon): 总管增加任务历史查询"
```

---

### Task 4: `retry_task` / `reopen_task` / `cancel_task`

Blocking: Task 3
Slice type: tracer-bullet
Seam: `tools.retry_task/reopen_task/cancel_task.execute`

**Files:**
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Test: `apps/daemon/test/supervisor-tools.test.ts`

**Interfaces:**
- Consumes: `deps.applyTransition(taskId, event)`、`deps.enqueueTask(taskId)`
- Produces: 返回 `{ ok, taskId, status, error? }`

- [ ] **Step 1: 写失败测试**

在 setup 里给 tools deps 加一个可观测的 `applyTransition`：

```ts
const transitions: Array<{ taskId: string; type: string }> = []
const tools = createSupervisorTools({
  // ...existing deps
  applyTransition: (taskId, event) => {
    transitions.push({ taskId, type: event.type })
    return {
      ok: true,
      taskId,
      status: event.type === 'retry' ? 'queued' : event.type === 'reopen' ? 'todo' : 'cancelled',
      previousStatus: 'failed',
      retryCount: 0,
      waitingReason: null,
      events: [],
    }
  },
})
```

测试：

```ts
it('retries only failed tasks and reopens only finished tasks', async () => {
  const { database, seeded, tools, transitions } = setup()
  database.raw.prepare('update task set status = ? where id = ?').run('failed', seeded.taskId)
  const retry = (await tools.retry_task.execute({ taskId: seeded.taskId, note: '再试一次' }, ctx(seeded))) as {
    status: string
  }
  expect(retry.status).toBe('queued')
  expect(transitions.at(-1)).toEqual({ taskId: seeded.taskId, type: 'retry' })

  database.raw.prepare('update task set status = ? where id = ?').run('done', seeded.taskId)
  const reopen = (await tools.reopen_task.execute({ taskId: seeded.taskId, start: true }, ctx(seeded))) as {
    status: string
  }
  expect(reopen.status).toBe('queued')
  expect(transitions.at(-1)).toEqual({ taskId: seeded.taskId, type: 'reopen' })
})

it('requires confirmation before cancelling a running task', async () => {
  const { database, seeded, tools, transitions } = setup()
  database.raw.prepare('update task set status = ? where id = ?').run('running', seeded.taskId)
  const pending = (await tools.cancel_task.execute({ taskId: seeded.taskId }, ctx(seeded))) as {
    ok: boolean
    code: string
  }
  expect(pending).toMatchObject({ ok: false, code: 'confirmation_required' })
  expect(transitions).toHaveLength(0)

  const done = (await tools.cancel_task.execute({ taskId: seeded.taskId, confirm: true }, ctx(seeded))) as {
    ok: boolean
    status: string
  }
  expect(done).toMatchObject({ ok: true, status: 'cancelled' })
  expect(transitions.at(-1)).toEqual({ taskId: seeded.taskId, type: 'cancel' })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-tools.test.ts`
Expected: FAIL，新工具不存在。

- [ ] **Step 3: 实现**

`SupervisorToolsDeps` 增加：

```ts
applyTransition: (taskId: string, event: TaskTransitionEvent) => TransitionOutcome
```

加 input schema：

```ts
const retryTaskInput = z.object({
  taskId: z.string().min(1),
  note: z.string().min(1).max(16_384).optional(),
})
const reopenTaskInput = z.object({
  taskId: z.string().min(1),
  note: z.string().min(1).max(16_384).optional(),
  start: z.boolean().default(false),
})
const cancelTaskInput = z.object({
  taskId: z.string().min(1),
  reason: z.string().min(1).max(1_000).optional(),
  confirm: z.boolean().default(false),
})
```

工具实现要点：

```ts
function requireTask(ctx: ToolContext, taskId: string): Task {
  const task = getTask(deps.db, taskId)
  if (!task || task.workspaceId !== ctx.workspaceId) {
    throw appError('task_not_found', 'task not found', { taskId })
  }
  return task
}

function transitionResult(outcome: TransitionOutcome) {
  if (!outcome.ok) throw outcome.error
  return { ok: true, taskId: outcome.taskId, status: outcome.status }
}
```

```ts
retry_task: {
  description: '重试一个失败任务；只有 failed 可用。note 用用户原话，写入 <feedback>。',
  parameters: retryTaskInput,
  async execute(input, ctx) {
    const parsed = retryTaskInput.parse(input)
    const task = requireTask(ctx, parsed.taskId)
    if (task.status !== 'failed') {
      throw appError('invalid_transition', 'only failed tasks can be retried', {
        taskId: task.id,
        status: task.status,
      })
    }
    const result = transitionResult(
      deps.applyTransition(task.id, {
        type: 'retry',
        ...(parsed.note ? { note: parsed.note } : {}),
      }),
    )
    deps.audit({ action: 'supervisor.task.retry', taskId: task.id, ctx, hasNote: Boolean(parsed.note) })
    return result
  },
},
```

`reopen_task`：仅 `done/cancelled`，`applyTransition({ type:'reopen', note? })`；`start` 时 `deps.enqueueTask(task.id)`，入队失败返回 `{ ...result, status: 'todo', startError }`。`cancel_task`：终态拒绝；`running && !confirm` 返回 `{ ok:false, code:'confirmation_required', taskId, status }`；否则 `applyTransition({ type:'cancel', reason? })`。

审计：在 `SupervisorToolsDeps` 增加 `audit` 回调，或直接 `insertAudit`。推荐给 deps 一个：

```ts
audit: (input: { action: string; taskId: string; ctx: ToolContext; detail?: Record<string, unknown> }) => void
```

由 `service.ts` 注入，统一写 `insertAudit`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-tools.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/supervisor/tools.ts apps/daemon/src/supervisor/service.ts apps/daemon/test/supervisor-tools.test.ts
git commit -m "feat(daemon): 总管增加 retry/reopen/cancel 售后工具"
```

---

### Task 5: 抽出 `replyToTask` 并加 `reply_task`

Blocking: Task 4
Slice type: refactor + tracer-bullet
Seam: `tools.reply_task.execute` 与 `runtime.replyToTask`

**Files:**
- Modify: `apps/daemon/src/runtime/index.ts`
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Modify: `apps/daemon/src/supervisor/service.ts`
- Test: `apps/daemon/test/supervisor-tools.test.ts`

**Interfaces:**
- Consumes: `getTask`、`canAcceptUserInput`、`sessionHolder.has`、`applyTransition`
- Produces: `replyToTask(taskId, text): CommandOutcome`

- [ ] **Step 1: 写失败测试**

```ts
it('replies only to non-approval waiting tasks with an active session', async () => {
  const { database, seeded, tools, replies } = setup()
  database.raw
    .prepare('update task set status = ?, waiting_reason = ? where id = ?')
    .run('waiting_input', 'question', seeded.taskId)

  const ok = (await tools.reply_task.execute({ taskId: seeded.taskId, text: '用方案 A' }, ctx(seeded))) as {
    ok: boolean
  }
  expect(ok.ok).toBe(true)
  expect(replies).toEqual([{ taskId: seeded.taskId, text: '用方案 A' }])

  database.raw
    .prepare('update task set status = ?, waiting_reason = ? where id = ?')
    .run('waiting_input', 'approval', seeded.taskId)
  await expect(
    tools.reply_task.execute({ taskId: seeded.taskId, text: '同意' }, ctx(seeded)),
  ).rejects.toMatchObject({ code: 'reply_not_allowed' })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-tools.test.ts`
Expected: FAIL，`reply_task` 不存在。

- [ ] **Step 3: 实现**

`runtime/index.ts`：把 `case 'session.reply'` 的 guard 抽成局部函数（保留原有错误码）：

```ts
function replyToTask(taskId: string, text: string): CommandOutcome {
  const task = getTask(deps.db, taskId)
  if (!task) return { ok: false, error: appError('task_not_found', 'task not found', { taskId }) }
  if (task.status !== 'waiting_input') {
    return { ok: false, error: appError('reply_not_allowed', 'task is not waiting for input', { taskId, status: task.status }) }
  }
  if (!canAcceptUserInput(task.waitingReason)) {
    return { ok: false, error: appError('reply_not_allowed', 'approval must be decided with approval.decide', { taskId, waitingReason: task.waitingReason }) }
  }
  if (!sessionHolder.value?.has(task.id)) {
    return { ok: false, error: appError('session_not_active', 'no active session for task', { taskId }) }
  }
  return ackFromOutcome(applyTransition(task.id, { type: 'user_input', text }))
}
```

把 `case 'session.reply'` 改为 `return replyToTask(message.payload.taskId, message.payload.text)`；把 `replyToTask` 传给 `createSupervisorService`。

`SupervisorToolsDeps` 增加 `replyToTask`；工具：

```ts
reply_task: {
  description: '回复一个等待输入的任务；只转发用户原话，不处理审批。',
  parameters: replyTaskInput,
  async execute(input, ctx) {
    const parsed = replyTaskInput.parse(input)
    const task = requireTask(ctx, parsed.taskId)
    const result = deps.replyToTask(task.id, parsed.text)
    if (!result.ok) throw result.error
    deps.audit({ action: 'supervisor.task.reply', taskId: task.id, ctx, detail: { length: parsed.text.length } })
    return { ok: true, taskId: task.id, status: 'running' }
  },
},
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-tools.test.ts runtime.test.ts`
Expected: PASS；现有 `session.reply` 行为不变。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/runtime/index.ts apps/daemon/src/supervisor/tools.ts apps/daemon/src/supervisor/service.ts apps/daemon/test/supervisor-tools.test.ts
git commit -m "feat(daemon): 抽出 replyToTask 并接入总管"
```

---

### Task 6: `create_tasks` 从文本节点批量建任务

Blocking: Task 5
Slice type: tracer-bullet
Seam: `tools.create_tasks.execute`

**Files:**
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Test: `apps/daemon/test/supervisor-tools.test.ts`

**Interfaces:**
- Consumes: `taskService.createTask`、`enqueueTask`、`resolveAgentTarget`/`resolveEngine`/`resolveContext` 的共享逻辑
- Produces: `create_tasks({ nodeIds, targetNodeId?, agentTitle?, engine?, contextNodeIds?, start? })`

- [ ] **Step 1: 写失败测试**

在 setup 中把 `newId` 改为序列：

```ts
let idSeq = 0
newId: () => `task-${++idSeq}`
```

测试：

```ts
it('creates one todo task per text node with a shared agent', async () => {
  const { database, seeded, tools } = setup()
  seedTextNode(database.raw, seeded.canvasId, 'text-2', '需求 B')
  seedTextNode(database.raw, seeded.canvasId, 'text-3', '需求 C')

  const result = (await tools.create_tasks.execute(
    { nodeIds: ['text-1', 'text-2', 'text-3'], targetNodeId: seeded.nodeId },
    ctx(seeded),
  )) as { created: Array<{ taskId: string; status: string }>; failed: unknown[] }

  expect(result.failed).toEqual([])
  expect(result.created).toHaveLength(3)
  expect(result.created.every((card) => card.status === 'todo')).toBe(true)
  const rows = database.raw
    .prepare('select node_id, prompt, status from task where id like ?')
    .all('task-%') as Array<{ node_id: string; prompt: string; status: string }>
  expect(rows).toHaveLength(3)
  expect(new Set(rows.map((row) => row.node_id))).toEqual(new Set([seeded.nodeId]))
  expect(rows.map((row) => row.prompt)).toEqual(['需求 A', '需求 B', '需求 C'])
})

it('rejects duplicate, non-text and over-limit nodeIds', async () => {
  const { seeded, tools } = setup()
  await expect(
    tools.create_tasks.execute({ nodeIds: ['text-1', 'text-1'] }, ctx(seeded)),
  ).rejects.toMatchObject({ code: 'supervisor_batch_invalid' })
  await expect(
    tools.create_tasks.execute({ nodeIds: [seeded.nodeId] }, ctx(seeded)),
  ).rejects.toMatchObject({ code: 'supervisor_batch_invalid' })
  await expect(
    tools.create_tasks.execute(
      { nodeIds: ['t1', 't2', 't3', 't4', 't5', 't6', 't7'] },
      ctx(seeded),
    ),
  ).rejects.toMatchObject({ code: 'supervisor_batch_invalid' })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-tools.test.ts`
Expected: FAIL，`create_tasks` 不存在。

- [ ] **Step 3: 实现**

抽出单任务创建 helper，避免复制 origin/audit：

```ts
function createTaskFromNode(
  ctx: ToolContext,
  input: {
    title: string
    prompt: string
    target: { id: string; title: string; engine: EngineValue }
    contextNodeIds: string[]
    workspaceMode: 'main'
    start: boolean
  },
): { ok: true; card: SupervisorTaskCardValue; enqueueError?: AppError } | { ok: false; error: AppError } {
  const origin = buildTaskOrigin({
    source: 'supervisor-chat',
    triggerId: ctx.triggerId,
    threadId: ctx.threadId,
    workspaceId: ctx.workspaceId,
    targetNodeId: input.target.id,
    contextNodeIds: input.contextNodeIds,
    policyVersion: ctx.policyVersion,
    promptVersion: ctx.promptVersion,
    createdAt: deps.now(),
  })
  const result = deps.taskService.createTask(
    {
      workspaceId: ctx.workspaceId,
      nodeId: input.target.id,
      title: input.title,
      prompt: input.prompt,
      contextNodeIds: input.contextNodeIds,
      engine: input.target.engine,
      workspaceMode: 'main',
      dangerouslySkipPermissions: false,
    },
    {
      origin,
      audit: {
        actor: 'supervisor',
        action: 'supervisor.task.create',
        detail: { triggerId: ctx.triggerId, threadId: ctx.threadId, batch: true },
      },
    },
  )
  if (!result.ok) return { ok: false, error: result.error }
  if (input.start) {
    const enqueued = deps.enqueueTask(result.taskId)
    if (enqueued.ok) {
      return { ok: true, card: card(result.taskId, input.title, input.target, input.contextNodeIds.length, 'queued') }
    }
    return {
      ok: true,
      card: card(result.taskId, input.title, input.target, input.contextNodeIds.length, 'todo'),
      enqueueError: enqueued.error,
    }
  }
  return { ok: true, card: card(result.taskId, input.title, input.target, input.contextNodeIds.length, 'todo') }
}
```

`create_tasks` 执行流程：

```ts
const parsed = createTasksInput.parse(input)
const canvas = canvasFor(ctx)
const nodes = parsed.nodeIds.map((id) => getNode(deps.db, id))
const duplicate = parsed.nodeIds.length !== new Set(parsed.nodeIds).size
if (duplicate || parsed.nodeIds.length < 1 || parsed.nodeIds.length > 6) {
  throw appError('supervisor_batch_invalid', 'nodeIds must be 1-6 unique ids', { nodeIds: parsed.nodeIds })
}
const textNodes = nodes.filter(
  (node): node is Node & { type: 'text' } =>
    Boolean(node && node.canvasId === canvas.id && node.type === 'text' && node.data.content.trim()),
)
if (textNodes.length !== parsed.nodeIds.length) {
  throw appError('supervisor_batch_invalid', 'all nodeIds must be non-empty text nodes on this canvas', { nodeIds: parsed.nodeIds })
}
const target = resolveAgentTarget(ctx, {
  title: textTitle(textNodes[0]!.data.content),
  targetNodeId: parsed.targetNodeId,
  agentTitle: parsed.agentTitle,
  engine: parsed.engine,
  contextNodeIds: [],
  workspaceMode: 'main',
  start: false,
})
const engine = resolveEngine(parsed.engine, target)
const targetWithEngine = { ...target, engine }
const contextNodeIds = resolveContext(
  ctx,
  (parsed.contextNodeIds ?? []).filter((id) => !parsed.nodeIds.includes(id)),
  target.id,
)
const created: SupervisorTaskCardValue[] = []
const failed: Array<{ nodeId: string; stage: 'create' | 'enqueue'; error: AppError }> = []
for (const node of textNodes) {
  const result = createTaskFromNode(ctx, {
    title: textTitle(node.data.content).slice(0, 80),
    prompt: node.data.content,
    target: targetWithEngine,
    contextNodeIds,
    workspaceMode: 'main',
    start: parsed.start,
  })
  if (!result.ok) {
    failed.push({ nodeId: node.id, stage: 'create', error: result.error })
    continue
  }
  if (result.enqueueError) {
    failed.push({ nodeId: node.id, stage: 'enqueue', error: result.enqueueError })
  }
  created.push(result.card)
}
deps.audit({
  action: 'supervisor.task.batch',
  taskId: created[0]?.taskId ?? '',
  ctx,
  detail: { nodeIds: parsed.nodeIds, createdTaskIds: created.map((card) => card.taskId), failed: failed.map((item) => item.nodeId), started: parsed.start },
})
return { created, failed }
```

注意：`resolveAgentTarget` 的入参类型要放宽为只依赖它用到的字段，或抽一个 `resolveBatchTarget`；不要伪造完整 `TaskCreateInput`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-tools.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/supervisor/tools.ts apps/daemon/test/supervisor-tools.test.ts
git commit -m "feat(daemon): 总管支持从文本节点批量建任务"
```

---

### Task 7: 提示词、14 工具接线与 claim 守卫

Blocking: Task 6
Slice type: tracer-bullet
Seam: `createAiSdkSupervisorEngine` 请求体与 `supervisor-service` claim 守卫

**Files:**
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Modify: `apps/daemon/src/supervisor/service.ts`
- Modify: `apps/daemon/src/supervisor/prompt.ts`
- Test: `apps/daemon/test/supervisor-engine-mock.test.ts`
- Test: `apps/daemon/test/supervisor-service.test.ts`

**Interfaces:**
- Consumes: 前 6 个任务
- Produces: 14 个工具全部出现在真实引擎请求体；prompt 规则可被测试断言

- [ ] **Step 1: 写失败测试**

`supervisor-engine-mock.test.ts` 的 `tools()` 增加 6 个 noop，并把断言改为 14 个：

```ts
expect(sentTools.sort()).toEqual([
  'cancel_task',
  'create_agent',
  'create_edge',
  'create_task',
  'create_tasks',
  'create_text',
  'enqueue_task',
  'get_task',
  'get_task_history',
  'list_canvas',
  'list_tasks',
  'reopen_task',
  'reply_task',
  'retry_task',
])
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-engine-mock.test.ts`
Expected: FAIL，缺少新工具。

- [ ] **Step 3: 实现**

- `SupervisorToolset`/`BoundToolset` 增加 6 个键。
- `bindTools` 增加 6 个 bind。
- `createSupervisorTools` 返回值增加 6 个工具，并把 `applyTransition/replyToTask/audit` 从 deps 传入。
- `service.ts` 的 `wrapped` 增加 6 个 `wrapTool`。
- `prompt.ts` 工具清单改为 14 个，加入 spec §5 的 9 条规则；`PROMPT_VERSION` 自动变化。
- `service.ts` claim 守卫：在现有“声称建任务/完成”之外，增加：
  ```ts
  const claimed = /已(重试|重开|取消|回复|批量建)|已经(重试|重开|取消|回复)/.test(text)
  const acted = result.toolCalls.some((call) =>
    ['retry_task', 'reopen_task', 'cancel_task', 'reply_task', 'create_tasks'].includes(call.name) && call.ok,
  )
  if (claimed && !acted) {
    text += '\n\n（我没有对应的工具结果；请以任务详情/看板状态为准。）'
    reason = 'claim_without_tool'
  }
  ```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-engine-mock.test.ts supervisor-service.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/supervisor apps/daemon/test/supervisor-engine-mock.test.ts apps/daemon/test/supervisor-service.test.ts
git commit -m "feat(daemon): 总管接入售后与批量工具"
```

---

## 最终验证

```bash
pnpm --filter @evanfang0054/baton test
pnpm verify
```

---

## 计划自检

- Spec 覆盖：工具 1-4、批量 5-6、提示词/守卫 7；支付/验收/外部 Source 明确不在本计划。
- 无占位符：每个任务都有测试、实现、运行、提交。
- 类型一致：`SupervisorTaskCardValue`、`TransitionOutcome`、`CommandOutcome`、`TaskTransitionEvent` 均来自现有模块；若实现时发现类型不匹配，先改本计划再动代码。
