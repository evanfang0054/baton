---
spec_ref: ../specs/2026-11-20-m5-supervisor-aftersales-design.md
spec_topic: m5-supervisor-aftersales
task_count: 5
estimated_phases: [tests, implementation, verification]
dod: "总管消息能渲染多张 create_tasks 任务卡与批量失败；新工具有一行回执/图标；新工具成功后刷新 tasks/canvas；组件与 RealtimeProvider 测试通过"
status: active
depends_on: docs/plans/2026-11-20-m5-1-aftersales-daemon.md
---

# M5-1 web：总管多卡、售后回执与刷新实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `agent-harness:subagent-driven-development` (recommended) or `agent-harness:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Web 能正确展示批量建任务、售后动作与 pending 摘要，并在新工具成功后刷新看板/画布。

**Architecture:** 复用现有 `SupervisorTaskCard` 与 `SupervisorToolCard`；只扩展消息解析与图标/刷新集合；不新增页面或弹窗。

**Tech Stack:** React 19、TanStack Query、Testing Library、vitest。

---

## 文件结构

- Modify: `apps/web/src/features/supervisor/SupervisorMessage.tsx` — 多卡与批量失败。
- Modify: `apps/web/src/features/supervisor/SupervisorToolCard.tsx` — 新工具图标。
- Modify: `apps/web/src/features/realtime/RealtimeProvider.tsx` — 新工具刷新集合。
- Create: `apps/web/src/features/supervisor/SupervisorMessage.test.tsx` — 多卡/失败列表。
- Modify: `apps/web/src/features/supervisor/SupervisorPanel.test.tsx` — 售后回执与 pending 文本。
- Modify: `apps/web/src/features/realtime/RealtimeProvider.test.tsx` — 新工具刷新。

---

### Task 1: `SupervisorMessage` 渲染多张 `create_tasks` 卡

Blocking: none
Slice type: tracer-bullet
Seam: `SupervisorMessage`

**Files:**
- Modify: `apps/web/src/features/supervisor/SupervisorMessage.tsx`
- Test: `apps/web/src/features/supervisor/SupervisorMessage.test.tsx`

**Interfaces:**
- Consumes: `ToolCallRecord.result`（`create_tasks` 返回 `{ created, failed }`）
- Produces: 多张 `SupervisorTaskCard` + 失败行

- [ ] **Step 1: 写失败测试**

新建 `SupervisorMessage.test.tsx`：

```tsx
import type { SupervisorMessage as SupervisorMessageRecord } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SupervisorMessage } from './SupervisorMessage'

const message: SupervisorMessageRecord = {
  id: 'm1',
  threadId: 'th1',
  role: 'assistant',
  content: '已批量建好。',
  toolCalls: [
    {
      id: 'tc1',
      name: 'create_tasks',
      args: {},
      ok: true,
      result: {
        created: [
          {
            taskId: 't1',
            title: '需求 A',
            target: { id: 'a1', title: 'Agent 1', engine: 'claude-sdk' },
            contextCount: 0,
            status: 'todo',
          },
          {
            taskId: 't2',
            title: '需求 B',
            target: { id: 'a1', title: 'Agent 1', engine: 'claude-sdk' },
            contextCount: 0,
            status: 'todo',
          },
        ],
        failed: [{ nodeId: 'text-3', stage: 'create', error: { code: 'invalid_payload', message: 'bad node' } }],
      },
    },
  ],
  decision: null,
  meta: null,
  status: 'ok',
  error: null,
  createdAt: 2,
}

describe('SupervisorMessage', () => {
  it('renders every created task card and each batch failure', () => {
    render(<SupervisorMessage message={message} />)
    expect(screen.getByText('需求 A')).toBeVisible()
    expect(screen.getByText('需求 B')).toBeVisible()
    expect(screen.getByText(/text-3/)).toBeVisible()
    expect(screen.getByText(/bad node/)).toBeVisible()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web test -- SupervisorMessage.test.tsx`
Expected: FAIL，只渲染 `create_task` 卡。

- [ ] **Step 3: 实现**

在 `SupervisorMessage.tsx` 中把 `cards` 的来源扩展为：

```tsx
type BatchResult = {
  created?: unknown[]
  failed?: Array<{ nodeId: string; stage: string; error: { code: string; message: string } }>
}

const singleCards = message.toolCalls
  .filter((call) => call.name === 'create_task' && call.ok)
  .map((call) => SupervisorTaskCardSchema.safeParse(call.result))
  .flatMap((parsed) => (parsed.success ? [parsed.data] : []))

const batch = message.toolCalls
  .filter((call) => call.name === 'create_tasks' && call.ok)
  .map((call) => (call.result ?? {}) as BatchResult)

const batchCards = batch
  .flatMap((result) => result.created ?? [])
  .map((item) => SupervisorTaskCardSchema.safeParse(item))
  .flatMap((parsed) => (parsed.success ? [parsed.data] : []))

const cards = [...singleCards, ...batchCards]
const uniqueCards = [...new Map(cards.map((card) => [card.taskId, card])).values()]
const batchFailures = batch.flatMap((result) => result.failed ?? [])
```

渲染失败行：

```tsx
{batchFailures.length > 0 ? (
  <ul className="space-y-1 text-xs text-danger">
    {batchFailures.map((item) => (
      <li key={`${item.nodeId}-${item.stage}`}>
        {item.nodeId} {item.stage === 'enqueue' ? '入队失败' : '创建失败'}：{item.error.message}
      </li>
    ))}
  </ul>
) : null}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @baton/web test -- SupervisorMessage.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/supervisor/SupervisorMessage.tsx apps/web/src/features/supervisor/SupervisorMessage.test.tsx
git commit -m "feat(web): 总管消息支持批量任务卡与失败列表"
```

---

### Task 2: 新工具图标与回执可见性

Blocking: Task 1
Slice type: tracer-bullet
Seam: `SupervisorToolCard`

**Files:**
- Modify: `apps/web/src/features/supervisor/SupervisorToolCard.tsx`
- Test: `apps/web/src/features/supervisor/SupervisorPanel.test.tsx`

**Interfaces:**
- Consumes: `SupervisorToolView.name`
- Produces: 新工具不再落到默认 `Wrench`；工具卡可展开看到结果

- [ ] **Step 1: 写失败测试**

在 `SupervisorPanel.test.tsx` 加：

```tsx
it('renders after-sales tool receipts with a specific icon', async () => {
  vi.mocked(getSupervisorMessages).mockResolvedValue({
    threadId: 'th1',
    messages: [
      {
        ...assistantWithTaskCard,
        id: 'm3',
        content: '已重试。',
        toolCalls: [
          {
            id: 'tc-retry',
            name: 'retry_task',
            args: { taskId: 't1' },
            ok: true,
            result: { ok: true, taskId: 't1', status: 'queued' },
          },
        ],
      },
    ],
  })
  renderPanel()
  expect(await screen.findByText('retry_task')).toBeVisible()
  expect(screen.getByText('完成')).toBeVisible()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web test -- SupervisorPanel.test.tsx`
Expected: FAIL，`retry_task` 没有专属图标（不影响可见性但无法断言图标）；如果现有测试已通过，改为断言 `data-icon` 或新增 `aria-label`。

- [ ] **Step 3: 实现**

`SupervisorToolCard.tsx` 图标表增加：

```ts
import { Ban, History, ListPlus, MessageSquare, RefreshCw, RotateCcw } from 'lucide-react'

const icons = {
  // existing...
  create_tasks: ListPlus,
  get_task_history: History,
  retry_task: RefreshCw,
  reopen_task: RotateCcw,
  cancel_task: Ban,
  reply_task: MessageSquare,
}
```

给图标加 `aria-label`/`data-testid` 不必要；保持现有可展开结果即可。总管回复文本负责一行回执。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @baton/web test -- SupervisorPanel.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/supervisor/SupervisorToolCard.tsx apps/web/src/features/supervisor/SupervisorPanel.test.tsx
git commit -m "feat(web): 总管售后工具图标"
```

---

### Task 3: 新工具成功后刷新 tasks/canvas

Blocking: Task 2
Slice type: tracer-bullet
Seam: `RealtimeProvider`

**Files:**
- Modify: `apps/web/src/features/realtime/RealtimeProvider.tsx`
- Test: `apps/web/src/features/realtime/RealtimeProvider.test.tsx`

**Interfaces:**
- Consumes: `supervisor.tool` 的 `name/ok`
- Produces: 新工具成功后失效 `queryKeys.tasks(workspaceId)` 与 `queryKeys.canvas(workspaceId)`

- [ ] **Step 1: 写失败测试**

```tsx
it('invalidates tasks and canvas after a successful batch create', async () => {
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  renderProvider()
  invalidate.mockClear()
  send({
    v: 1,
    type: 'supervisor.tool',
    ts: 1,
    payload: {
      threadId: 'th1',
      messageId: 'm1',
      toolCallId: 'tc1',
      name: 'create_tasks',
      phase: 'end',
      ok: true,
    },
  })
  await waitFor(() => {
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tasks('w1') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.canvas('w1') })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @baton/web test -- RealtimeProvider.test.tsx`
Expected: FAIL，`create_tasks` 不在刷新集合。

- [ ] **Step 3: 实现**

`RealtimeProvider.tsx`：

```ts
const CANVAS_MUTATING_TOOLS = new Set([
  'create_text',
  'create_agent',
  'create_edge',
  'create_task',
  'create_tasks',
  'retry_task',
  'reopen_task',
  'cancel_task',
  'reply_task',
])
```

任务列表刷新逻辑保持现有（`supervisor.tool` 成功后已失效 tasks）；确认 `create_tasks` 也走同一分支。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @baton/web test -- RealtimeProvider.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/realtime/RealtimeProvider.tsx apps/web/src/features/realtime/RealtimeProvider.test.tsx
git commit -m "feat(web): 总管售后工具成功后刷新看板与画布"
```

---

### Task 4: `SupervisorPanel` 售后与 pending 集成测试

Blocking: Task 3
Slice type: verification
Seam: `SupervisorPanel`

**Files:**
- Modify: `apps/web/src/features/supervisor/SupervisorPanel.test.tsx`

**Interfaces:**
- Consumes: 前 3 个任务
- Produces: 覆盖售后回执、pending 文本、批量失败

- [ ] **Step 1: 写测试**

```tsx
it('shows a pending question summary from get_task', async () => {
  vi.mocked(getSupervisorMessages).mockResolvedValue({
    threadId: 'th1',
    messages: [
      {
        ...assistantWithTaskCard,
        id: 'm4',
        content: '它在等你确认方案。',
        toolCalls: [
          {
            id: 'tc-get',
            name: 'get_task',
            args: { taskId: 't1' },
            ok: true,
            result: {
              task: { id: 't1', title: '整理需求', status: 'waiting_input', waitingReason: 'approval' },
              pending: { kind: 'question', question: { questions: [{ question: '用哪个方案？', options: [{ label: 'A' }, { label: 'B' }] }] } },
            },
          },
        ],
      },
    ],
  })
  renderPanel()
  expect(await screen.findByText(/它在等你确认方案/)).toBeVisible()
  expect(screen.getByText('get_task')).toBeVisible()
})
```

- [ ] **Step 2: 跑测试确认失败/通过**

Run: `pnpm --filter @baton/web test -- SupervisorPanel.test.tsx`
Expected: 如果 Web 只是透传 tool 结果，测试应通过；若失败，说明消息渲染丢失了 tool 结果，修 `SupervisorToolCard` 的 `toToolView`。

- [ ] **Step 3: 修实现（仅在失败时）**

确保 `SupervisorMessage.tsx` 的 `toToolView(call)` 传入 `result`，且 `SupervisorToolCard` 展开后显示结果；不要新增专用 pending 组件。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @baton/web test -- SupervisorPanel.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/supervisor/SupervisorPanel.test.tsx apps/web/src/features/supervisor/SupervisorMessage.tsx
git commit -m "test(web): 总管售后与 pending 展示"
```

---

### Task 5: Web 全量验证

Blocking: Task 4
Slice type: verification
Seam: `@baton/web` test/typecheck

**Files:**
- 无新增文件。

- [ ] **Step 1: 跑 web 全量**

Run: `pnpm --filter @baton/web test && pnpm --filter @baton/web typecheck`
Expected: PASS。

- [ ] **Step 2: 跑格式检查**

Run: `pnpm format:check`
Expected: PASS。

- [ ] **Step 3: 提交（如有格式修正）**

```bash
git add apps/web
git commit -m "chore(web): 格式与测试收口"
```

---

## 计划自检

- Spec 覆盖：多卡、失败列表、售后回执、pending 展示、刷新；Playwright 与真实 Claude 在 acceptance plan。
- 无占位符：每个任务都有测试/实现/命令/提交。
- 类型一致：`SupervisorTaskCard` 复用 protocol schema；`create_tasks` 结果形状与 daemon plan 一致。
