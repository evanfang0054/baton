---
spec_ref: ../specs/2026-11-19-m3-delivery-acceptance-design.md
contract_ref: ../contracts/M3-1-delivery-acceptance.contract.md
spec_topic: m3-1-delivery-acceptance
task_count: 7
estimated_phases: [tests, implementation, verification]
dod: "failed 可 retry、done/cancelled 可 reopen；重置 retryCount、刷新 policy、保留历史；任务详情有时间线"
depends_on: 2026-11-19-m3-1-worktree.md
---

# M3-1 Slice 3：retry / reopen / 任务历史实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans. 每任务结束提交，不 push。

**Goal:** 失败任务能人工重试，完成/取消任务能重新打开；两者都开新 episode、保留历史，并在任务详情看到时间线。

**Architecture:** core 只加纯转移与 effects；daemon 在 transition runner 里做 policy 刷新与 audit；history 复用 `ws_event.task_id` + session/review 表；web 通过独立 REST 拉时间线，动作走现有 WS 命令。

**Tech Stack:** zod 4、Drizzle/SQLite、Fastify 5、React 19、TanStack Query、HeroUI v3、vitest、Playwright。

---

### Task 1: 协议与 core 转移

Blocking: none
Slice type: tracer-bullet
Seam: `transition()` 对 retry/reopen 返回正确状态、retryCount、effects

**Files:**
- Modify: `packages/protocol/src/transitions.ts`
- Modify: `packages/protocol/src/commands.ts`
- Modify: `packages/core/src/state-machine/transition.ts`
- Modify: `packages/core/src/state-machine/effects.ts`
- Modify: `packages/core/src/state-machine/types.ts`
- Test: `packages/core/test/transition-matrix.test.ts`
- Test: `packages/core/test/effects.test.ts`

**Interfaces:**
- Produces:
  - `TaskTransitionEvent` 的 `retry` / `reopen`
  - `TaskRetryInput` / `TaskReopenInput`
  - `effects.appendReopenNote(note)`

- [ ] **Step 1: 写失败测试**

```ts
it('retries failed tasks with a new episode', () => {
  const result = transition(ctx({ status: 'failed', retryCount: 2 }), { type: 'retry', note: '再试一次' })
  expect(result).toMatchObject({ ok: true, status: 'queued', retryCount: 0 })
  expect(result.ok && result.effects.map((e) => e.type)).toEqual(['appendFeedback', 'enqueueTask', 'emitTaskStatus'])
})

it('reopens done tasks to todo without auto-enqueue', () => {
  const result = transition(ctx({ status: 'done' }), { type: 'reopen', note: '继续修' })
  expect(result).toMatchObject({ ok: true, status: 'todo', retryCount: 0 })
  expect(result.ok && result.effects.map((e) => e.type)).toEqual(['appendReopenNote', 'emitTaskStatus'])
})

it('rejects retry from running and reopen from review', () => {
  expect(transition(ctx({ status: 'running' }), { type: 'retry' }).ok).toBe(false)
  expect(transition(ctx({ status: 'review' }), { type: 'reopen' }).ok).toBe(false)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/core exec vitest run test/transition-matrix.test.ts`
Expected: FAIL（未知事件/状态）

- [ ] **Step 3: 实现**

`transitions.ts`：

```ts
z.object({ type: z.literal('retry'), note: z.string().min(1).max(16_384).optional() }),
z.object({ type: z.literal('reopen'), note: z.string().min(1).max(16_384).optional() }),
```

`commands.ts`：`TaskRetryInput` / `TaskReopenInput`，并加入 `ClientMessage` 的 `task.retry` / `task.reopen`。

`effects.ts`：

```ts
appendReopenNote: (note: string): TaskEffect => ({ type: 'appendReopenNote', note }),
```

`types.ts` 的 `TaskEffect` 联合增加：

```ts
| { type: 'appendReopenNote'; note: string }
```

`transition.ts`：把 `done/failed/cancelled` 拆开：

```ts
case 'failed':
  if (event.type === 'retry') {
    const extra = [effects.enqueueTask()]
    if (event.note) extra.unshift(effects.appendFeedback(event.note))
    return ok('queued', 0, extra)
  }
  return invalid(ctx, event)

case 'done':
case 'cancelled':
  if (event.type === 'reopen') {
    const extra = event.note ? [effects.appendReopenNote(event.note)] : []
    return ok('todo', 0, extra)
  }
  return invalid(ctx, event)
```

注意 `ok()` 会把 `emitTaskStatus` 放最后。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @baton/core exec vitest run test/transition-matrix.test.ts test/effects.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/transitions.ts packages/protocol/src/commands.ts packages/core/src/state-machine packages/core/test
git commit -m "feat(core): add retry and reopen transitions"
```

---

### Task 2: daemon 备注块与 effect 处理

Blocking: Task 1
Slice type: tracer-bullet
Seam: retry 备注进 `<feedback>`，reopen 备注进 `<reopen_note>`

**Files:**
- Modify: `apps/daemon/src/db/repositories.ts`
- Modify: `apps/daemon/src/runtime/effects.ts`
- Test: `apps/daemon/test/repositories.test.ts`
- Test: `apps/daemon/test/transition-runner.test.ts`

**Interfaces:**
- Consumes: `effects.appendReopenNote`
- Produces: `appendTaskPromptBlock(..., 'reopen_note', ...)`

- [ ] **Step 1: 写失败测试**

```ts
it('appends reopen_note and keeps the original prompt', () => {
  const before = getTask(db, taskId)!.prompt
  applyTransition(taskId, { type: 'reopen', note: '继续修边界' })
  expect(getTask(db, taskId)!.prompt).toBe(`${before}\n\n<reopen_note>\n继续修边界\n</reopen_note>`)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/transition-runner.test.ts -t "reopen_note"`
Expected: FAIL（未知 effect）

- [ ] **Step 3: 实现**

- `repositories.ts`：`appendTaskPromptBlock` 的 tag 联合加 `'reopen_note'`。
- `runtime/effects.ts`：`case 'appendReopenNote': appendTaskPromptBlock(tx, ctx.task.id, 'reopen_note', effect.note, MAX_FEEDBACK_CHARS, ctx.now)`。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/repositories.test.ts test/transition-runner.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/db/repositories.ts apps/daemon/src/runtime/effects.ts apps/daemon/test
git commit -m "feat(daemon): handle reopen note effect"
```

---

### Task 3: transition runner 刷新 policy、写 audit、接命令

Blocking: Task 2
Slice type: tracer-bullet
Seam: `task.retry`/`task.reopen` 经 WS 可用；policyVersion 与 audit 正确

**Files:**
- Modify: `apps/daemon/src/runtime/transition-runner.ts`
- Modify: `apps/daemon/src/runtime/index.ts`
- Test: `apps/daemon/test/transition-runner.test.ts`
- Test: `apps/daemon/test/ws-router.test.ts`

**Interfaces:**
- Consumes: `loadPolicy`、`updateTaskPolicy`、`insertAudit`
- Produces: `task.retry` / `task.reopen` 命令；audit `task.retry` / `task.reopen`

- [ ] **Step 1: 写失败测试**

```ts
it('refreshes policy and audits a manual retry', async () => {
  const outcome = runtime.handleCommand({
    v: 1, id: 'c1', ts: 1, type: 'task.retry', payload: { taskId: failedTaskId, note: '再试' },
  })
  expect(outcome.ok).toBe(true)
  expect(getTask(db, failedTaskId)!.retryCount).toBe(0)
  expect(listAudit(db, { actionPrefix: 'task.retry' })[0].detail).toMatchObject({
    taskId: failedTaskId, policyVersion: expect.any(String),
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/transition-runner.test.ts -t "manual retry"`
Expected: FAIL（命令未知）

- [ ] **Step 3: 实现**

- `transition-runner.ts`：在加载 workspace/policy 的条件里加入 `event.type === 'retry' || event.type === 'reopen'`；在 `db.transaction` 内，`updateTaskState` 之后：

```ts
if (event.type === 'retry' || event.type === 'reopen') {
  updateTaskPolicy(tx, task.id, policy)
  insertAudit(tx, {
    id: deps.newId(),
    ts: now,
    actor: 'human',
    action: `task.${event.type}`,
    detail: { taskId: task.id, workspaceId: task.workspaceId, policyVersion: hashPolicy(policy) },
  })
}
```

`hashPolicy` 直接复用 `apps/daemon/src/automation/version.ts` 的导出，不要重复实现。

- `runtime/index.ts` `handleCommand`：

```ts
case 'task.retry':
  return ackFromOutcome(
    applyTransition(message.payload.taskId, {
      type: 'retry',
      ...(message.payload.note ? { note: message.payload.note } : {}),
    }),
  )
case 'task.reopen':
  return ackFromOutcome(
    applyTransition(message.payload.taskId, {
      type: 'reopen',
      ...(message.payload.note ? { note: message.payload.note } : {}),
    }),
  )
```

并发请求由同步 `applyTransition` 串行化：第一个成功后状态改变，第二个返回 `invalid_transition`。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/transition-runner.test.ts test/ws-router.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/runtime/transition-runner.ts apps/daemon/src/runtime/index.ts apps/daemon/test
git commit -m "feat(daemon): wire retry and reopen commands"
```

---

### Task 4: 历史查询与 REST

Blocking: Task 3
Slice type: tracer-bullet
Seam: `GET /api/tasks/:id/history` 返回状态/session/review；`beforeOrdinal` 可翻页

**Files:**
- Modify: `apps/daemon/src/db/repositories.ts`
- Modify: `packages/protocol/src/api.ts`
- Modify: `apps/daemon/src/http/tasks.ts`
- Test: `apps/daemon/test/rest-api.test.ts`

**Interfaces:**
- Produces:
  - `TaskHistoryQuery`（`limit` 默认 200、上限 500；`beforeOrdinal` 可选）
  - `TaskStatusHistoryItem` / `TaskHistoryResponse`
  - `listTaskStatusHistory`、`listReviewsByTask`

- [ ] **Step 1: 写失败测试**

```ts
it('returns status events, sessions and reviews', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/history?limit=10` })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.statusEvents[0]).toMatchObject({ status: 'review', previousStatus: 'verifying' })
  expect(body.sessions.length).toBeGreaterThan(0)
  expect(body.reviews[0].diffAvailable).toBe(true)
  expect(body).not.toHaveProperty('transcript')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/rest-api.test.ts -t "history"`
Expected: FAIL（404）

- [ ] **Step 3: 实现**

- `repositories.ts`：
  - `listTaskStatusHistory(db, taskId, limit, beforeOrdinal?)` 查 `ws_event`（`task_id` + `type='task.status'`），`orderBy(desc(ordinal))`，解析 payload 为 `TaskStatusHistoryItem`，返回 `{ items, nextBeforeOrdinal }`。
  - `listReviewsByTask(db, taskId)` 按 rowid 倒序返回 `ReviewView[]`（含 `diffAvailable`）。
- `api.ts`：定义 `TaskHistoryQuery`（`limit` 默认 200、上限 500；`beforeOrdinal` 可选）。`TaskStatusHistoryItem` / `TaskHistoryResponse` 已在 Slice 1 Task 1 定义，本任务只补查询类型与仓库函数。
- `http/tasks.ts`：`GET /api/tasks/:id/history`；任务不存在 → `task_not_found`；返回 `TaskHistoryResponse.parse({ taskId, statusEvents, sessions, reviews, nextBeforeOrdinal })`。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/rest-api.test.ts`
Expected: PASS（含坏 JSON 行被跳过）

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/api.ts apps/daemon/src/db/repositories.ts apps/daemon/src/http/tasks.ts apps/daemon/test/rest-api.test.ts
git commit -m "feat(daemon): task history endpoint"
```

---

### Task 5: web 历史时间线

Blocking: Task 4
Slice type: tracer-bullet
Seam: 任务详情展开“历史”能看到状态/session/review

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/query.ts`
- Create: `apps/web/src/features/tasks/TaskHistory.tsx`
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.tsx`
- Test: `apps/web/src/features/tasks/TaskHistory.test.tsx`

**Interfaces:**
- Consumes: `TaskHistoryResponse`、`getTaskHistory`
- Produces: `<TaskHistory taskId onOpenDiff={...} />`

- [ ] **Step 1: 写失败测试**

```tsx
it('renders status, session and review items', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
    taskId: 't1',
    statusEvents: [{ ordinal: 3, ts: 3, status: 'review', previousStatus: 'verifying', retryCount: 0 }],
    sessions: [{ id: 's1', taskId: 't1', adapter: 'fake', status: 'ended', outcome: 'ready', startedAt: 1, endedAt: 2 }],
    reviews: [{ id: 'r1', taskId: 't1', verdict: 'approved', verifyExitCode: 0, verifyOutput: '', diffStat: { filesChanged: 1, insertions: 1, deletions: 0 }, decidedAt: 4, diffAvailable: true }],
  })))
  renderWithQuery(<TaskHistory taskId="t1" onOpenDiff={vi.fn()} />)
  expect(await screen.findByText(/待验收/)).toBeInTheDocument()
  expect(screen.getByText(/ready/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /查看改动/ })).toBeInTheDocument()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/tasks/TaskHistory.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现**

- `api.ts`：`getTaskHistory(taskId, beforeOrdinal?)`。
- `query.ts`：`taskHistory: (taskId) => ['task-history', taskId]`。
- `TaskHistory.tsx`：默认折叠；展开时 `useQuery`；合并 status/session/review 为按 ts 倒序列表；状态用中文标签；review 有 `diffAvailable` 时按钮触发 `onOpenDiff(review.id)`；空态“还没有记录”。
- `TaskDetailPanel`：桌面在 `ReviewCard` 下方、移动端作为 `MobileCollapsible title="历史"`；`onDone` 同时失效 `taskHistory(taskId)`。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @baton/web exec vitest run src/features/tasks/TaskHistory.test.tsx src/features/tasks/TaskDetailPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/query.ts apps/web/src/features/tasks/TaskHistory.tsx apps/web/src/features/tasks/TaskDetailPanel.tsx apps/web/src/features/tasks/TaskHistory.test.tsx
git commit -m "feat(web): task history timeline"
```

---

### Task 6: web retry / reopen 动作

Blocking: Task 5
Slice type: tracer-bullet
Seam: failed 显示重试、done/cancelled 显示重新打开；备注可填

**Files:**
- Modify: `apps/web/src/features/tasks/TaskActions.tsx`
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.tsx`（移动端 footer 条件）
- Test: `apps/web/src/features/tasks/TaskActions.test.tsx`
- Test: `apps/web/src/features/tasks/TaskDetailPanel.mobile.test.tsx`

**Interfaces:**
- Consumes: `task.retry` / `task.reopen`
- Produces: 终态动作 UI 与移动端入口

- [ ] **Step 1: 写失败测试**

```tsx
it('sends task.retry with an optional note', async () => {
  render(<CommandProvider send={send}><TaskActions taskId="t1" workspaceId="w1" status="failed" attention="none" /></CommandProvider>)
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  fireEvent.change(screen.getByLabelText('重试备注'), { target: { value: '再试一次' } })
  fireEvent.click(screen.getByRole('button', { name: '确认重试' }))
  await waitFor(() => expect(send).toHaveBeenCalledWith({
    type: 'task.retry', payload: { taskId: 't1', note: '再试一次' },
  }))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/tasks/TaskActions.test.tsx`
Expected: FAIL（终态不渲染动作）

- [ ] **Step 3: 实现**

- `TaskActions`：`failed` → 内联确认 + 可选 `TextArea`（`aria-label="重试备注"`）+ “重试/确认重试”；`done`/`cancelled` → “重新打开/确认重新打开”，`aria-label="重开备注"`。
- 提交 `task.retry` / `task.reopen`；pending 禁用；错误 `role="alert"`；成功后失效 `task`、`tasks`、`taskHistory`。
- `TaskDetailPanel` 移动端 footer 条件加入 `failed`/`done`/`cancelled`，确保移动端能看到动作。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @baton/web exec vitest run src/features/tasks/TaskActions.test.tsx src/features/tasks/TaskDetailPanel.mobile.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/tasks/TaskActions.tsx apps/web/src/features/tasks/TaskDetailPanel.tsx apps/web/src/features/tasks/TaskActions.test.tsx apps/web/src/features/tasks/TaskDetailPanel.mobile.test.tsx
git commit -m "feat(web): retry and reopen actions"
```

---

### Task 7: Playwright 售后与历史

Blocking: Task 6
Slice type: verification
Seam: failed→retry、done→reopen、历史时间线在桌面/移动可用

**Files:**
- Create: `apps/web/e2e/aftersales.spec.ts`

- [ ] **Step 1: 写 e2e**

用 `page.route` 固定 task/tasks/history/session 响应；断言 failed 任务显示“重试”、done 任务显示“重新打开”；点击后发出的 WS 命令 payload 正确；历史展开显示状态/session/review；移动视窗同样可用。

- [ ] **Step 2: 跑 e2e 确认失败**

Run: `pnpm exec playwright test e2e/aftersales.spec.ts`
Expected: FAIL

- [ ] **Step 3: 修正 UI 细节**

按 e2e 反馈修可访问名称、移动 footer 条件、历史空态。

- [ ] **Step 4: 跑测试**

Run: `pnpm exec playwright test e2e/aftersales.spec.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/e2e/aftersales.spec.ts
git commit -m "test(web): retry reopen and history e2e"
```

---

## 本片完成门禁

- `pnpm verify`
- `pnpm --filter @baton/core exec vitest run test/transition-matrix.test.ts test/effects.test.ts`
- `pnpm --filter @evanfang0054/baton exec vitest run test/transition-runner.test.ts test/ws-router.test.ts test/rest-api.test.ts`
- `pnpm --filter @baton/web exec vitest run src/features/tasks`
- `pnpm exec playwright test e2e/aftersales.spec.ts`
- `pnpm check:protocol`、`pnpm check:boundaries`、`pnpm format:check`
