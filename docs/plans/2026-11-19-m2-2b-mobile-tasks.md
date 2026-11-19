---
spec_ref: ../specs/2026-11-19-m2-2b-mobile-console-design.md
spec_topic: m2-2b-mobile-console
task_count: 6
estimated_phases: [tests, implementation, verification]
dod: "移动看板待处理优先 + 批量开工；任务详情闸门/操作条/transcript 可用；<768 完成审批→回复→验收→开工的移动闭环；桌面/平板回归"
depends_on: [2026-11-19-m2-2b-mobile-foundation.md]
status: active
---

# M2-2b 移动端响应式控制台：任务与闸门实施计划（Plan 2/4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`（推荐）或 `executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选。

**Goal:** 把 Plan 1 的移动壳补成可用的任务闭环：待处理优先看板、批量开工、任务详情、审批/提问/回复/验收、transcript 与粘性操作条。

**Architecture:** 继续使用现有 `TaskCard`、`ApprovalCard`、`QuestionCard`、`ReviewCard`、`ReplyComposer`、`TaskActions`、`Transcript`；移动端只改布局与容器，不复制业务逻辑。`TaskDetailPanel` 增加 `mobile` 分支：页面可滚动、transcript 有界、操作条 sticky。

**Tech Stack:** React 19、HeroUI v3、TanStack Query、Zustand、vitest + Testing Library、Playwright。

> GDD 显式跳过：本 plan 无后端/状态机变更；测试由 contract DoD 3/4 + spec §10 移动用例承担。

---

## File Structure

**Create**

- `apps/web/src/features/tasks/MobileBoardList.batch.test.tsx` — 移动看板批量开工。
- `apps/web/src/features/tasks/TaskDetailPanel.mobile.test.tsx` — 移动详情布局与闸门。
- `apps/web/e2e/mobile-tasks.spec.ts` — 移动审批与批量开工 e2e。

**Modify**

- `apps/web/src/features/tasks/MobileBoardList.tsx` — 待处理分组、筛选、最长等待、批量选择。
- `apps/web/src/features/tasks/MobileBoardList.test.tsx` — 新分组/筛选断言。
- `apps/web/src/features/tasks/TaskActions.tsx` — `sticky` 操作条。
- `apps/web/src/features/tasks/TaskActions.test.tsx` — sticky class。
- `apps/web/src/features/tasks/TaskDetailPanel.tsx` — `mobile` 布局、折叠卡片、有界 transcript。
- `apps/web/src/App.tsx` — `<TaskDetailPanel mobile />`。

---

## Task 1: 移动看板待处理优先 + 筛选 + 最长等待

Blocking: Plan 1 Task 6
Slice type: tracer-bullet
Seam: 分组标题、计数、最长等待、筛选

**Files:**

- Modify: `apps/web/src/features/tasks/MobileBoardList.tsx`
- Modify: `apps/web/src/features/tasks/MobileBoardList.test.tsx`

**Interfaces:**

- Consumes: `TaskSummary[]`、`groupTasks`、`TaskCard`、`WaitingTime`。
- Produces: 待处理三组（待审批/待回复/待验收）、筛选 chips、最长等待文案。

- [ ] **Step 1: 写失败测试**

在 `MobileBoardList.test.tsx` 增加：

```tsx
it('splits attention into approval/reply/review and shows the oldest wait', () => {
  render(
    <MobileBoardList
      tasks={[
        task({ id: 'a', title: '待审批', status: 'waiting_input', attention: 'needs_approval', waitingSince: 3 }),
        task({ id: 'b', title: '待回复', status: 'waiting_input', attention: 'needs_reply', waitingSince: 1 }),
        task({ id: 'c', title: '待验收', status: 'review', attention: 'needs_review', waitingSince: 2 }),
      ]}
      selectedTaskId={null}
      onSelectTask={() => {}}
      onOpenSupervisor={() => {}}
    />,
  )

  expect(screen.getByRole('heading', { name: /待审批/ })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /待回复/ })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /待验收/ })).toBeInTheDocument()
  expect(screen.getByText(/最久等待/)).toBeInTheDocument()
})

it('filters to todo tasks', async () => {
  render(
    <MobileBoardList
      tasks={[
        task({ id: 'a', title: '待审批', status: 'waiting_input', attention: 'needs_approval' }),
        task({ id: 'b', title: '待办任务', status: 'todo' }),
      ]}
      selectedTaskId={null}
      onSelectTask={() => {}}
      onOpenSupervisor={() => {}}
    />,
  )

  await userEvent.click(screen.getByRole('tab', { name: '待办' }))
  expect(screen.getByText('待办任务')).toBeInTheDocument()
  expect(screen.queryByText('待审批')).not.toBeInTheDocument()
})
```

Run: `pnpm --filter @baton/web test -- MobileBoardList`

Expected: FAIL。

- [ ] **Step 2: 重写 `MobileBoardList`**

```tsx
import type { Attention, TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { toast } from '@heroui/react/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useCommand } from '../../lib/command-context'
import { groupTasks } from './columns'
import { TaskCard } from './TaskCard'
import { WaitingTime } from './WaitingTime'

type Filter = 'all' | 'attention' | 'active' | 'todo' | 'done'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'attention', label: '待处理' },
  { id: 'active', label: '进行中' },
  { id: 'todo', label: '待办' },
  { id: 'done', label: '已完成' },
]

const ATTENTION_GROUPS: Array<{ id: Attention; label: string }> = [
  { id: 'needs_approval', label: '待审批' },
  { id: 'needs_reply', label: '待回复' },
  { id: 'needs_review', label: '待验收' },
]

const BATCH_LIMIT = 20

function oldestWaitingSince(tasks: TaskSummary[]): number | null {
  return tasks.reduce<number | null>((oldest, task) => {
    if (!task.waitingSince) return oldest
    return oldest === null || task.waitingSince < oldest ? task.waitingSince : oldest
  }, null)
}

function Section({
  title,
  tasks,
  selectedTaskId,
  onSelectTask,
  empty,
  selecting,
  selected,
  onToggle,
}: {
  title: string
  tasks: TaskSummary[]
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
  empty: string
  selecting: boolean
  selected: Set<string>
  onToggle: (taskId: string) => void
}) {
  return (
    <section className="mb-4" data-mobile-section={title}>
      <h2 className="mb-2 text-xs font-medium text-muted">
        {title} {tasks.length > 0 ? `(${tasks.length})` : ''}
      </h2>
      {tasks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-separator p-3 text-xs text-muted">
          {empty}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              selected={selecting ? selected.has(task.id) : task.id === selectedTaskId}
              selectable={selecting && task.status === 'todo'}
              onSelect={onSelectTask}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function MobileBoardList({
  tasks,
  selectedTaskId,
  onSelectTask,
  onOpenSupervisor,
}: {
  tasks: TaskSummary[]
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
  onOpenSupervisor: () => void
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batching, setBatching] = useState(false)

  const grouped = groupTasks(tasks)
  const todoTasks = tasks.filter((task) => task.status === 'todo')
  const activeSelected = new Set(
    [...selected].filter((id) => todoTasks.some((task) => task.id === id)),
  )
  const oldest = oldestWaitingSince(tasks)
  const attentionCount = tasks.filter((task) => task.attention !== 'none').length

  const startSelecting = () => {
    setSelecting(true)
    setSelected(new Set())
  }
  const exitSelection = () => {
    setSelecting(false)
    setSelected(new Set())
  }
  const toggle = (taskId: string) => {
    setSelected((previous) => {
      const next = new Set([...previous].filter((id) => todoTasks.some((task) => task.id === id)))
      if (next.has(taskId)) next.delete(taskId)
      else if (next.size < BATCH_LIMIT) next.add(taskId)
      return next
    })
  }
  const selectAll = () => setSelected(new Set(todoTasks.slice(0, BATCH_LIMIT).map((t) => t.id)))

  const startBatch = async () => {
    if (batching || activeSelected.size === 0) return
    setBatching(true)
    let started = 0
    let failed = 0
    for (const taskId of activeSelected) {
      try {
        await send({ type: 'task.enqueue', payload: { taskId } })
        started += 1
      } catch {
        failed += 1
      }
    }
    setBatching(false)
    await queryClient.invalidateQueries({ queryKey: ['tasks'] })
    if (failed > 0) toast.danger(`已开工 ${started} 个，${failed} 个失败`)
    else toast.success(`已开工 ${started} 个`)
    exitSelection()
  }

  const showAttention = filter === 'all' || filter === 'attention'
  const showActive = filter === 'all' || filter === 'active'
  const showTodo = filter === 'all' || filter === 'todo'
  const showDone = filter === 'all' || filter === 'done'

  return (
    <div data-testid="mobile-board" className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 pt-3">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold">任务</h1>
          {attentionCount > 0 ? (
            <p className="mt-0.5 text-xs text-warning">
              需要你处理 {attentionCount} 个
              {oldest ? (
                <>
                  {' · '}
                  <span>最久等待 </span>
                  <WaitingTime since={oldest} />
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {selecting ? (
            <>
              <Button size="sm" variant="tertiary" isDisabled={todoTasks.length === 0} onPress={selectAll}>
                全选待办
              </Button>
              <Button size="sm" variant="tertiary" isDisabled={batching} onPress={exitSelection}>
                取消
              </Button>
              <Button
                size="sm"
                variant="primary"
                isDisabled={activeSelected.size === 0 || batching}
                onPress={() => void startBatch()}
              >
                开工 {activeSelected.size} 个
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                isDisabled={todoTasks.length === 0}
                onPress={startSelecting}
              >
                选择待办
              </Button>
              <Button size="sm" variant="secondary" onPress={onOpenSupervisor}>
                让总管建任务
              </Button>
            </>
          )}
        </div>
      </header>

      <div role="tablist" aria-label="任务筛选" className="mb-3 flex gap-1 overflow-x-auto">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs ${
              filter === item.id
                ? 'border-accent text-accent'
                : 'border-separator text-muted'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {showAttention
        ? ATTENTION_GROUPS.map((group) => {
            const groupTasksList = tasks.filter((task) => task.attention === group.id)
            return (
              <Section
                key={group.id}
                title={group.label}
                tasks={groupTasksList}
                selectedTaskId={selectedTaskId}
                onSelectTask={onSelectTask}
                empty={`没有${group.label}的任务`}
                selecting={selecting}
                selected={activeSelected}
                onToggle={toggle}
              />
            )
          })
        : null}

      {showActive ? (
        <Section
          title="进行中"
          tasks={grouped.running}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
          empty="没有进行中的任务"
          selecting={selecting}
          selected={activeSelected}
          onToggle={toggle}
        />
      ) : null}

      {showTodo ? (
        <Section
          title="待办"
          tasks={grouped.todo}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
          empty="没有待办任务"
          selecting={selecting}
          selected={activeSelected}
          onToggle={toggle}
        />
      ) : null}

      {showDone && grouped.done.length + grouped.closed.length > 0 ? (
        <Section
          title="已完成"
          tasks={[...grouped.done, ...grouped.closed]}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
          empty="没有已完成任务"
          selecting={selecting}
          selected={activeSelected}
          onToggle={toggle}
        />
      ) : null}

      {!selecting ? (
        <p className="mt-4 text-xs text-muted">待办任务可进入“选择待办”批量开工。</p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm --filter @baton/web test -- MobileBoardList`

Expected: PASS（4 tests）。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/features/tasks/MobileBoardList.tsx apps/web/src/features/tasks/MobileBoardList.test.tsx
git commit -m "feat(web): 移动看板按待处理分组并支持筛选"
```

---

## Task 2: 移动批量开工

Blocking: Task 1
Slice type: tracer-bullet
Seam: 多选两个待办 → 两次 `task.enqueue`；失败提示

**Files:**

- Create: `apps/web/src/features/tasks/MobileBoardList.batch.test.tsx`

**Interfaces:**

- Consumes: Task 1 的选择状态与 `startBatch`。
- Produces: 移动端批量开工行为。

- [ ] **Step 1: 写测试**

```tsx
import type { TaskSummary } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { MobileBoardList } from './MobileBoardList'

const { send } = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue(undefined) }))

function task(id: string, title: string): TaskSummary {
  return {
    id,
    workspaceId: 'w1',
    nodeId: `n-${id}`,
    title,
    prompt: '',
    status: 'todo',
    waitingReason: null,
    engine: 'fake',
    workspaceMode: 'main',
    branch: null,
    worktreePath: null,
    verifyCommand: null,
    dangerouslySkipPermissions: false,
    retryCount: 0,
    createdAt: 1,
    updatedAt: 1,
    attention: 'none',
    waitingSince: null,
  }
}

function renderList(tasks: TaskSummary[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <MobileBoardList
          tasks={tasks}
          selectedTaskId={null}
          onSelectTask={() => {}}
          onOpenSupervisor={() => {}}
        />
      </CommandProvider>
    </QueryClientProvider>,
  )
}

describe('MobileBoardList batch start', () => {
  beforeEach(() => send.mockClear())

  it('enqueues each selected todo task', async () => {
    renderList([task('t1', 'A'), task('t2', 'B')])

    await userEvent.click(screen.getByRole('button', { name: '选择待办' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 A' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 B' }))
    await userEvent.click(screen.getByRole('button', { name: '开工 2 个' }))

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'task.enqueue', payload: { taskId: 't1' } })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'task.enqueue', payload: { taskId: 't2' } })
  })

  it('does not select non-todo tasks', async () => {
    const running = { ...task('t3', 'C'), status: 'running' as const }
    renderList([task('t1', 'A'), running])

    await userEvent.click(screen.getByRole('button', { name: '选择待办' }))
    expect(screen.getByRole('checkbox', { name: '选择 A' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '选择 C' })).not.toBeInTheDocument()
  })
})
```

Run: `pnpm --filter @baton/web test -- MobileBoardList.batch`

Expected: PASS（Task 1 已实现）。

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/features/tasks/MobileBoardList.batch.test.tsx
git commit -m "test(web): 覆盖移动看板批量开工"
```

---

## Task 3: `TaskActions` sticky 与 `TaskDetailPanel` 移动布局

Blocking: Task 1
Slice type: refactor
Seam: `TaskDetailPanel mobile` 的滚动容器、有界 transcript、sticky actions

**Files:**

- Modify: `apps/web/src/features/tasks/TaskActions.tsx`
- Modify: `apps/web/src/features/tasks/TaskActions.test.tsx`
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.tsx`
- Create: `apps/web/src/features/tasks/TaskDetailPanel.mobile.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**

- `TaskActions` 新增 `sticky?: boolean`。
- `TaskDetailPanel` 新增 `mobile?: boolean`。
- `TaskDetailPanel` 内 transcript 容器新增 `data-testid="transcript-section"`。

- [ ] **Step 1: 写失败测试**

`TaskActions.test.tsx` 扩展 helper：

```tsx
function renderActions(
  status: 'todo' | 'queued' | 'running' | 'waiting_input' | 'review',
  send = vi.fn(),
  attention: 'none' | 'needs_attention' = 'none',
  sticky = false,
) {
  // ...原实现...
  <TaskActions taskId="t1" workspaceId="w1" status={status} attention={attention} sticky={sticky} />
}
```

增加：

```tsx
it('renders a sticky footer when requested', () => {
  renderActions('todo', vi.fn(), 'none', true)
  expect(screen.getByText('任务已创建，尚未开工。').closest('section')?.className).toContain('sticky')
})
```

`TaskDetailPanel.mobile.test.tsx`：

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { useAppStore } from '../../stores/app'
import { TaskDetailPanel } from './TaskDetailPanel'

function stubDetail() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/tasks/t1') {
        return Response.json({
          task: {
            id: 't1', workspaceId: 'w1', nodeId: 'n1', title: '移动任务', prompt: '',
            status: 'todo', waitingReason: null, engine: 'fake', workspaceMode: 'main',
            branch: null, worktreePath: null, verifyCommand: null,
            dangerouslySkipPermissions: false, retryCount: 0, createdAt: 1, updatedAt: 2,
            context: null, origin: null,
          },
          sessions: [],
          approvals: [],
          review: null,
          waitingSince: null,
          attention: 'none',
          contextInvalid: false,
          originInvalid: false,
        })
      }
      if (url === '/api/tasks/t1/automation') {
        return Response.json({
          taskId: 't1', retryCount: 0, lastVerifyExitCode: null,
          lastPolicyVersion: null, autoDecisions: [],
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
}

beforeEach(() => {
  useAppStore.setState({ activeWorkspaceId: 'w1', activeTaskId: 't1' })
})

afterEach(() => vi.unstubAllGlobals())

it('uses a scrollable mobile layout with bounded transcript and sticky actions', async () => {
  stubDetail()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={vi.fn()}>
        <TaskDetailPanel mobile />
      </CommandProvider>
    </QueryClientProvider>,
  )

  expect(await screen.findByText('移动任务')).toBeInTheDocument()
  expect(screen.getByTestId('task-detail').className).toContain('overflow-y-auto')
  expect(screen.getByTestId('transcript-section').className).toContain('h-[45vh]')
  expect(screen.getByText('任务已创建，尚未开工。').closest('section')?.className).toContain('sticky')
})
```

Run: `pnpm --filter @baton/web test -- TaskActions TaskDetailPanel.mobile`

Expected: FAIL。

- [ ] **Step 2: 改 `TaskActions`**

```tsx
export function TaskActions({
  taskId,
  workspaceId,
  status,
  attention,
  sticky = false,
}: {
  taskId: string
  workspaceId: string
  status: TaskStatus
  attention: Attention
  sticky?: boolean
}) {
```

两处 section class 改为：

```tsx
const sectionClass = sticky
  ? 'sticky bottom-0 z-10 shrink-0 rounded-lg border border-separator bg-background p-3 shadow-overlay'
  : 'shrink-0 rounded-lg border border-separator bg-background p-3'

const waitingClass = sticky
  ? 'sticky bottom-0 z-10 shrink-0 rounded-lg border border-warning border-l-2 bg-background p-3 shadow-overlay'
  : 'shrink-0 rounded-lg border border-warning border-l-2 bg-background p-3'
```

- [ ] **Step 3: 改 `TaskDetailPanel`**

函数签名：

```tsx
export function TaskDetailPanel({ mobile = false }: { mobile?: boolean }) {
```

根节点：

```tsx
<div
  data-testid="task-detail"
  className={
    mobile
      ? 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4'
      : 'flex min-h-0 flex-1 flex-col gap-3 p-4'
  }
>
```

`DetailContent` 增加 `mobile` prop 并传入 `sticky`：

```tsx
<DetailContent
  ...
  mobile={mobile}
/>
```

```tsx
<TaskActions
  taskId={task.id}
  workspaceId={workspaceId}
  status={task.status}
  attention={detail.attention}
  sticky={mobile}
/>
```

transcript 容器：

```tsx
<div
  data-testid="transcript-section"
  className={
    mobile
      ? 'flex h-[45vh] min-h-64 flex-col border-t border-separator pt-3'
      : 'flex min-h-0 flex-1 flex-col border-t border-separator pt-3'
  }
>
```

移动端折叠上下文/来源/自动化：

```tsx
function MobileCollapsible({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="shrink-0 rounded-lg border border-separator bg-surface p-3">
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  )
}
```

`DetailContent` 中：

```tsx
{mobile ? (
  <MobileCollapsible title="上下文与来源">
    <ContextSnapshotCard snapshot={task.context} invalid={detail.contextInvalid} targetNodeId={task.nodeId} />
    <TaskOriginCard origin={task.origin} invalid={detail.originInvalid} />
  </MobileCollapsible>
) : (
  <>
    <ContextSnapshotCard snapshot={task.context} invalid={detail.contextInvalid} targetNodeId={task.nodeId} />
    <TaskOriginCard origin={task.origin} invalid={detail.originInvalid} />
  </>
)}
{mobile ? (
  <MobileCollapsible title="自动化记录">
    <TaskAutomationCard taskId={task.id} />
  </MobileCollapsible>
) : (
  <TaskAutomationCard taskId={task.id} />
)}
```

`App.tsx` 移动详情：

```tsx
<MobileTaskDetail ...>
  <TaskDetailPanel mobile />
</MobileTaskDetail>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @baton/web test -- TaskActions TaskDetailPanel`

Expected: PASS（含现有桌面用例）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/tasks/TaskActions.tsx apps/web/src/features/tasks/TaskActions.test.tsx apps/web/src/features/tasks/TaskDetailPanel.tsx apps/web/src/features/tasks/TaskDetailPanel.mobile.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): 增加移动任务详情与粘性操作条"
```

---

## Task 4: Playwright 移动任务闭环

Blocking: Task 1、Task 2、Task 3
Slice type: verification
Seam: 移动审批允许 + 批量开工 e2e

**Files:**

- Create: `apps/web/e2e/mobile-tasks.spec.ts`

**Interfaces:**

- Consumes: 现有 `page.routeWebSocket` ack 模式；移动看板/详情 testid。
- Produces: 移动任务 e2e。

- [ ] **Step 1: 写 e2e**

```ts
import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

test.beforeEach(async ({ page }) => {
  // 复用 journey.spec.ts 的 routeWebSocket ack 模式。
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string }
      if (!message.id) return
      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${message.id}`,
          type: 'ack',
          ts: Date.now(),
          payload: { commandId: message.id, ok: true, data: { cursor: 0, hasMore: false } },
        }),
      )
    })
  })
})

test('approves a waiting task on mobile', async ({ page }) => {
  let approved = false

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/workspaces') {
      return route.fulfill({
        json: {
          workspaces: [
            { id: 'w1', name: 'demo', relPath: 'demo', trusted: true, projectHooks: 'off', trustedAt: 1, createdAt: 1 },
          ],
        },
      })
    }
    if (path === '/api/tasks') {
      return route.fulfill({
        json: {
          tasks: [
            {
              id: 't1', workspaceId: 'w1', nodeId: 'n1', title: '移动审批', prompt: '',
              status: approved ? 'running' : 'waiting_input', waitingReason: approved ? null : 'approval',
              engine: 'fake', workspaceMode: 'main', branch: null, worktreePath: null,
              verifyCommand: null, dangerouslySkipPermissions: false, retryCount: 0,
              createdAt: 1, updatedAt: 2,
              attention: approved ? 'none' : 'needs_approval', waitingSince: approved ? null : 2,
            },
          ],
        },
      })
    }
    if (path === '/api/tasks/t1') {
      return route.fulfill({
        json: {
          task: {
            id: 't1', workspaceId: 'w1', nodeId: 'n1', title: '移动审批', prompt: '',
            status: approved ? 'running' : 'waiting_input', waitingReason: approved ? null : 'approval',
            engine: 'fake', workspaceMode: 'main', branch: null, worktreePath: null,
            verifyCommand: null, dangerouslySkipPermissions: false, retryCount: 0,
            createdAt: 1, updatedAt: 2,
          },
          sessions: [],
          approvals: [
            {
              id: 'a1',
              sessionId: 's1',
              request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' },
              decision: approved ? 'allow' : null,
              decidedBy: approved ? 'user' : null,
              decidedAt: approved ? 3 : null,
              response: null,
            },
          ],
          review: null,
          waitingSince: approved ? null : 2,
          attention: approved ? 'none' : 'needs_approval',
          contextInvalid: false,
          originInvalid: false,
        },
      })
    }
    if (path === '/api/tasks/t1/automation') {
      return route.fulfill({
        json: { taskId: 't1', retryCount: 0, lastVerifyExitCode: null, lastPolicyVersion: null, autoDecisions: [] },
      })
    }
    if (path === '/api/canvas') {
      return route.fulfill({
        json: {
          canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
          nodes: [],
          edges: [],
        },
      })
    }
    if (path === '/api/notices') {
      return route.fulfill({ json: { notices: [] } })
    }
    return route.fulfill({ json: {} })
  })

  await page.goto('/?workspace=w1&task=t1')
  await expect(page.getByTestId('mobile-board')).toBeVisible()
  await page.getByRole('button', { name: /移动审批/ }).click()
  await expect(page.getByTestId('mobile-task-detail')).toBeVisible()
  approved = true
  await page.getByRole('button', { name: '允许' }).click()
  await expect(page.getByText('需要授权')).toHaveCount(0)
})
```

> 审批字段严格按 `packages/protocol/src/entities/approval.ts`：`id`、`sessionId`、`request`（含 `risk`）、`decision`、`decidedBy`、`decidedAt`、`response`。不要使用 `taskId` / `requestId` / `note` / `createdAt`。

Run: `pnpm exec playwright test apps/web/e2e/mobile-tasks.spec.ts`

Expected: 1 passed。

- [ ] **Step 2: 提交**

```bash
git add apps/web/e2e/mobile-tasks.spec.ts
git commit -m "test(web): 增加移动任务审批 e2e"
```

---

## Task 5: 移动批量开工 e2e

Blocking: Task 2
Slice type: verification
Seam: 选择两个待办 → 两次 enqueue

**Files:**

- Modify: `apps/web/e2e/mobile-tasks.spec.ts`

- [ ] **Step 1: 增加测试**

```ts
test('batch starts two todo tasks', async ({ page }) => {
  const enqueued: string[] = []
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string; payload?: { taskId?: string } }
      if (message.type === 'task.enqueue' && message.payload?.taskId) enqueued.push(message.payload.taskId)
      if (!message.id) return
      ws.send(JSON.stringify({
        v: 1, id: `ack-${message.id}`, type: 'ack', ts: Date.now(),
        payload: { commandId: message.id, ok: true, data: { cursor: 0, hasMore: false } },
      }))
    })
  })

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/workspaces') {
      return route.fulfill({ json: { workspaces: [{ id: 'w1', name: 'demo', relPath: 'demo', trusted: true, projectHooks: 'off', trustedAt: 1, createdAt: 1 }] } })
    }
    if (path === '/api/tasks') {
      return route.fulfill({
        json: {
          tasks: ['t1', 't2'].map((id, index) => ({
            id, workspaceId: 'w1', nodeId: `n${index}`, title: `待办 ${index + 1}`, prompt: '',
            status: 'todo', waitingReason: null, engine: 'fake', workspaceMode: 'main',
            branch: null, worktreePath: null, verifyCommand: null,
            dangerouslySkipPermissions: false, retryCount: 0,
            createdAt: 1, updatedAt: 1, attention: 'none', waitingSince: null,
          })),
        },
      })
    }
    if (path === '/api/canvas') {
      return route.fulfill({
        json: {
          canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
          nodes: [],
          edges: [],
        },
      })
    }
    if (path === '/api/notices') return route.fulfill({ json: { notices: [] } })
    return route.fulfill({ json: {} })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '选择待办' }).click()
  await page.getByRole('checkbox', { name: '选择 待办 1' }).check()
  await page.getByRole('checkbox', { name: '选择 待办 2' }).check()
  await page.getByRole('button', { name: '开工 2 个' }).click()
  await expect.poll(() => enqueued.sort()).toEqual(['t1', 't2'])
})
```

Run: `pnpm exec playwright test apps/web/e2e/mobile-tasks.spec.ts`

Expected: 2 passed。

- [ ] **Step 2: 提交**

```bash
git add apps/web/e2e/mobile-tasks.spec.ts
git commit -m "test(web): 增加移动批量开工 e2e"
```

---

## Task 6: 收口

Blocking: Task 1-5
Slice type: verification
Seam: 全量 web 测试 + e2e

- [ ] **Step 1: 跑验证**

```bash
pnpm --filter @baton/web test
pnpm exec playwright test apps/web/e2e/mobile-shell.spec.ts apps/web/e2e/mobile-tasks.spec.ts
pnpm verify
```

Expected: 全绿；桌面现有 e2e 不受影响。

- [ ] **Step 2: 提交执行记录**

在 plan 末尾追加“执行记录”段，记录实际差异、测试数量、已知问题；提交：

```bash
git add docs/plans/2026-11-19-m2-2b-mobile-tasks.md
git commit -m "docs(plan): 记录 M2-2b 任务与闸门执行结果"
```

---

## Self-Review

- **Spec coverage**：覆盖 spec §6.2（看板）、§6.3（详情/闸门）、contract DoD 3、4 与 DoD 14 的任务部分。
- **Placeholder scan**：无 TBD/TODO；e2e fixture 字段已按 `Approval` 与 `TaskDetailResponse` schema 对齐。
- **Type consistency**：`TaskActions.sticky`、`TaskDetailPanel.mobile`、`transcript-section`、`MobileBoardList` props 与 Plan 1 一致。
- **Risk**：移动详情保留现有卡片顺序（上下文/来源/自动化在闸门前），通过折叠与 sticky actions 控制首屏高度；若真实截图显示闸门被挤出首屏，再把 gates 提前并调整测试。

## Execution Handoff

Plan 2 已落 `docs/plans/2026-11-19-m2-2b-mobile-tasks.md`。执行方式同 Plan 1：subagent-driven（推荐）或 inline。
