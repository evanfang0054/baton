---
spec_ref: ../specs/2026-11-21-m6-task-scene-design.md
spec_topic: m6-task-scene
task_count: 6
estimated_phases: [tests, implementation, verification]
dod: 'M6-1 DoD 8、12-16：看板需要我、stale、review 卡联动、现场入口'
status: planned
depends_on: 2026-11-21-m6-1-canvas-web.md
---

# M6-1 Plan 4：Web 看板与注意力

> **For agentic workers:** REQUIRED SUB-SKILL: Use agent-harness:subagent-driven-development (recommended) or agent-harness:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把“需要我”变成看板的第一视图，并让 review 卡、stale 标记和现场入口在桌面/手机一致可用。

**Architecture:** 筛选/排序是纯客户端派生，复用 core 的 `needsPerson`/`isStale`/`sortByWaiting`；不新增 API。review 卡通过 `review.preliminary` 事件失效任务详情。

**Tech Stack:** React 19、TanStack Query、Zustand、Tailwind 4、HeroUI v3。

**Commit strategy:** 每个 task 末尾提交；若你要最后统一提交，执行前告诉我。

**Design sync:** stale 用 `bg-warning/10 + text-warning + 图标`，review 用 `border-accent`；所有状态同时有文字，不只用颜色；现场入口在桌面显示，手机隐藏。

---

### Task 1: 看板筛选与排序

Blocking: Plan 1 Task 4
Slice type: tracer-bullet
Seam: `TaskBoardFilters` + `visibleTasks`

**Files:**
- Create: `apps/web/src/features/tasks/TaskBoardFilters.tsx`
- Modify: `apps/web/src/features/tasks/TaskBoard.tsx`
- Test: `apps/web/src/features/tasks/TaskBoardFilters.test.tsx`
- Test: `apps/web/src/features/tasks/TaskBoard.filter.test.tsx`

**Interfaces:**
- `TaskFilter = 'all' | 'needs_me' | 'review' | 'waiting'`
- `filterTasks(tasks, { filter, query, now }): TaskSummary[]` 复用 `needsPerson`/`sortByWaiting`。

- [ ] **Step 1: 写失败测试**

```tsx
it('filters needs_me and sorts by waiting', () => {
  const tasks = [
    task({ id: 'a', status: 'review', attention: 'needs_review', waitingSince: 20 }),
    task({ id: 'b', status: 'waiting_input', attention: 'needs_reply', waitingSince: 10 }),
    task({ id: 'c', status: 'running', attention: 'none', waitingSince: null }),
  ]
  expect(filterTasks(tasks, { filter: 'needs_me', query: '', now: 100 }).map((task) => task.id))
    .toEqual(['b', 'a'])
})

it('searches title case-insensitively', () => {
  expect(filterTasks([task({ title: '登录页重构' })], { filter: 'all', query: '登录', now: 1 }))
    .toHaveLength(1)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/web test -- TaskBoardFilters`
Expected: FAIL，组件/函数不存在。

- [ ] **Step 3: 实现**

```tsx
// TaskBoardFilters.tsx
export type TaskFilter = 'all' | 'needs_me' | 'review' | 'waiting'

export function filterTasks(
  tasks: TaskSummary[],
  input: { filter: TaskFilter; query: string; now: number },
): TaskSummary[] {
  const query = input.query.trim().toLowerCase()
  return sortByWaiting(
    tasks.filter((task) => {
      if (query && !task.title.toLowerCase().includes(query)) return false
      if (input.filter === 'all') return true
      if (input.filter === 'needs_me') return needsPerson({ status: task.status, attention: task.attention })
      if (input.filter === 'review') return task.status === 'review'
      return task.status === 'waiting_input'
    }),
  )
}

export function TaskBoardFilters({ filter, query, onFilter, onQuery }: {...}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {[
        ['all', '全部'],
        ['needs_me', '需要我'],
        ['review', '待验收'],
        ['waiting', '待处理'],
      ].map(([value, label]) => (
        <Button key={value} size="sm" variant={filter === value ? 'primary' : 'tertiary'}
          onPress={() => onFilter(value as TaskFilter)}>{label}</Button>
      ))}
      <Input aria-label="搜索任务" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索标题" />
    </div>
  )
}
```

`TaskBoard` 增加 `filter/query` state，`visibleTasks = filterTasks(tasks, { filter, query, now: Date.now() })`，`groupTasks(visibleTasks)`；header 下方渲染 `TaskBoardFilters`；筛选时批量选择只对 `visibleTasks` 里的 todo 生效。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/web test -- TaskBoardFilters TaskBoard.filter`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/tasks
git commit -m "feat(web): 看板需要我筛选与排序"
```

---

### Task 2: TaskCard stale 与「看现场」

Blocking: Plan 1 Task 4
Slice type: tracer-bullet
Seam: `TaskCard` 结构

**Files:**
- Modify: `apps/web/src/features/tasks/TaskCard.tsx`
- Test: `apps/web/src/features/tasks/TaskCard.test.tsx`

**Interfaces:**
- `TaskCard` 增加 `stale?: boolean`、`onOpenScene?: (taskId: string) => void`。
- 外层从 `<button>` 改为 `<div>`，主区域一个 `<button>`，场景动作为独立 `<button>`，避免嵌套按钮。

- [ ] **Step 1: 写失败测试**

```tsx
it('shows stale text and calls onOpenScene without selecting the task', async () => {
  const onSelect = vi.fn()
  const onOpenScene = vi.fn()
  render(<TaskCard task={task({ waitingSince: 1 })} stale onSelect={onSelect} onOpenScene={onOpenScene} />)
  expect(screen.getByText('已等待超过 30 分钟')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '看现场' }))
  expect(onOpenScene).toHaveBeenCalledWith('t1')
  expect(onSelect).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/web test -- TaskCard`
Expected: FAIL，stale/场景按钮不存在。

- [ ] **Step 3: 实现**

```tsx
export function TaskCard({ task, stale = false, onOpenScene, ...props }: TaskCardProps) {
  return (
    <div className={`${cardClass} ${border}`}>
      <button type="button" className="w-full text-left" onClick={() => props.onSelect(task.id)}>
        {body}
      </button>
      <div className="mt-2 flex items-center justify-between gap-2">
        {stale ? (
          <span className="flex items-center gap-1 text-xs text-warning">
            <Clock size={12} aria-hidden="true" /> 已等待超过 30 分钟
          </span>
        ) : <span />}
        {onOpenScene ? (
          <Button size="sm" variant="tertiary" onPress={() => onOpenScene(task.id)}>看现场</Button>
        ) : null}
      </div>
    </div>
  )
}
```

`BoardColumn` 传 `stale={isStale(task.waitingSince, Date.now())}`；`TaskBoard` 透传 `onOpenScene`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/web test -- TaskCard`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/tasks
git commit -m "feat(web): 任务卡 stale 与现场入口"
```

---

### Task 3: BoardRail「需要我」计数

Blocking: Task 1/2
Slice type: tracer-bullet
Seam: rail 计数

**Files:**
- Modify: `apps/web/src/features/tasks/BoardRail.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/features/tasks/BoardRail.test.tsx`

**Interfaces:**
- `BoardRail` counts 增加 `needs_me: number`。
- `App` 用 `needsPerson` 统计 `needs_me`，并与 `TaskBoard` 的筛选后列表长度一致。

- [ ] **Step 1: 写失败测试**

```tsx
it('shows needs_me count', () => {
  render(<BoardRail counts={{ needs_me: 3, needs_approval: 1, needs_reply: 1, needs_review: 1 }} total={5} ... />)
  expect(screen.getByText('需要我')).toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/web test -- BoardRail`
Expected: FAIL，counts 类型不含 needs_me。

- [ ] **Step 3: 实现**

```tsx
interface BoardRailProps {
  counts: { needs_me: number; needs_approval: number; needs_reply: number; needs_review: number }
  total: number
}
// 在“待审批”前加：
<RailCount label="需要我" value={counts.needs_me} tone="accent" />
```

`App`：

```ts
needs_me: list.filter((task) => needsPerson({ status: task.status, attention: task.attention })).length,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/web test -- BoardRail App`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/tasks/BoardRail.tsx apps/web/src/App.tsx
git commit -m "feat(web): rail 需要我计数"
```

---

### Task 4: 手机看板筛选/排序/stale

Blocking: Task 1/2
Slice type: tracer-bullet
Seam: `MobileBoardList`

**Files:**
- Modify: `apps/web/src/features/tasks/MobileBoardList.tsx`
- Test: `apps/web/src/features/tasks/MobileBoardList.test.tsx`

**Interfaces:**
- 复用 `filterTasks`；增加筛选按钮和 stale 文本；不加入「看现场」。

- [ ] **Step 1: 写失败测试**

```tsx
it('filters needs_me and marks stale on mobile', () => {
  render(<MobileBoardList tasks={[reviewOld, running]} ... />)
  expect(screen.getByText('已等待超过 30 分钟')).toBeInTheDocument()
  expect(screen.queryByText('看现场')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/web test -- MobileBoardList`
Expected: FAIL，stale 文本不存在。

- [ ] **Step 3: 实现**

- 顶部加「全部 / 需要我」两个按钮 + 搜索输入。
- 用 `filterTasks` 生成列表。
- 每条任务显示 `isStale(task.waitingSince, Date.now())` 的文本。
- 不渲染 `onOpenScene`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/web test -- MobileBoardList`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/tasks/MobileBoardList.tsx
git commit -m "feat(web): 手机看板筛选与 stale"
```

---

### Task 5: 任务详情「看现场」与 review 初步结论

Blocking: Plan 3 Task 5
Slice type: tracer-bullet
Seam: `TaskHeader` / `ReviewCard`

**Files:**
- Modify: `apps/web/src/features/tasks/TaskHeader.tsx`
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.tsx`
- Modify: `apps/web/src/features/tasks/ReviewCard.tsx`
- Test: `apps/web/src/features/tasks/TaskDetailPanel.test.tsx`
- Test: `apps/web/src/features/tasks/ReviewCard.test.tsx`

**Interfaces:**
- `TaskHeader` 增加 `onOpenScene?: () => void`，渲染「看现场」。
- `ReviewCard` 显示 `preliminaryVerdict/reason/at`，明确“最终由你决定”。

- [ ] **Step 1: 写失败测试**

```tsx
it('shows preliminary verdict and keeps human gate', () => {
  render(<ReviewCard review={{ ...review, preliminaryVerdict: 'pass', preliminaryReason: 'VERDICT: PASS' }} onDone={() => {}} />)
  expect(screen.getByText('初步验收：PASS')).toBeInTheDocument()
  expect(screen.getByText(/最终通过或打回由你决定/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '通过' })).toBeInTheDocument()
})

it('opens scene from task header', async () => {
  const onOpenScene = vi.fn()
  render(<TaskHeader task={task} attention="none" waitingSince={null} onOpenScene={onOpenScene} />)
  await user.click(screen.getByRole('button', { name: '看现场' }))
  expect(onOpenScene).toHaveBeenCalled()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/web test -- TaskDetailPanel ReviewCard`
Expected: FAIL，按钮/文案不存在。

- [ ] **Step 3: 实现**

`TaskHeader`：

```tsx
{onOpenScene ? (
  <Button size="sm" variant="tertiary" onPress={onOpenScene}>看现场</Button>
) : null}
```

`TaskDetailPanel`：

```ts
const setSceneTask = useAppStore((state) => state.setSceneTask)
const openScene = () => {
  if (!activeTaskId) return
  setSceneTask(activeTaskId)
  setRightPanel('task')
}
<TaskHeader ... onOpenScene={activeTaskId ? openScene : undefined} />
```

`ReviewCard` 增加：

```tsx
<section className="mt-3 rounded border border-separator bg-background p-2">
  <p className="text-xs font-medium text-foreground">
    初步验收：{review.preliminaryVerdict === 'pass' ? 'PASS' : review.preliminaryVerdict === 'fail' ? 'FAIL' : '进行中/未完成'}
  </p>
  {review.preliminaryReason ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{review.preliminaryReason}</p> : null}
  <p className="mt-1 text-xs text-muted">这是验收员的初步建议，最终通过或打回由你决定。</p>
</section>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/web test -- TaskDetailPanel ReviewCard`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/tasks
git commit -m "feat(web): 看现场入口与初步验收展示"
```

---

### Task 6: `review.preliminary` 实时失效

Blocking: Plan 2 Task 5
Slice type: tracer-bullet
Seam: `RealtimeProvider`

**Files:**
- Modify: `apps/web/src/features/realtime/RealtimeProvider.tsx`
- Test: `apps/web/src/features/realtime/RealtimeProvider.test.tsx`

**Interfaces:**
- 收到 `review.preliminary` 时失效 `queryKeys.task(payload.taskId)` 与 `queryKeys.tasks(workspaceId)`。

- [ ] **Step 1: 写失败测试**

```tsx
it('invalidates target task on review.preliminary', async () => {
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  emit({ type: 'review.preliminary', payload: { taskId: 't1', reviewId: 'r1', verdict: 'pass', at: 1 } })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.task('t1') })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/web test -- RealtimeProvider`
Expected: FAIL，事件未处理。

- [ ] **Step 3: 实现**

```ts
if (event.type === 'review.preliminary') {
  void queryClient.invalidateQueries({ queryKey: queryKeys.task(event.payload.taskId) })
  if (workspaceId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(workspaceId) })
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/web test -- RealtimeProvider`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/realtime
git commit -m "feat(web): 预验收事件刷新"
```

---

## 验收

```bash
pnpm --filter @baton/web test
pnpm --filter @baton/web typecheck
pnpm format:check
```

Expected: 全部通过；现有 web 204 tests 不回归。
