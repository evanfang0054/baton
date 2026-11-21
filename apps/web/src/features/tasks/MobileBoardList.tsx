import { isStale } from '@baton/core'
import type { Attention, TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { toast } from '@heroui/react/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useCommand } from '../../lib/command-context'
import { groupTasks } from './columns'
import { filterTasks } from './TaskBoardFilters'
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
  { id: 'needs_attention', label: '需关注' },
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
        {title}
        {tasks.length > 0 ? ` (${tasks.length})` : ''}
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
              stale={isStale(task.waitingSince, Date.now())}
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
  onCreateTask,
}: {
  tasks: TaskSummary[]
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
  onOpenSupervisor: () => void
  onCreateTask?: () => void
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  const [needsMe, setNeedsMe] = useState(false)
  const [query, setQuery] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batching, setBatching] = useState(false)
  const [doneOpen, setDoneOpen] = useState(false)

  const visibleTasks = useMemo(
    () =>
      filterTasks(tasks, {
        filter: needsMe ? 'needs_me' : 'all',
        query,
        now: Date.now(),
      }),
    [needsMe, query, tasks],
  )
  const grouped = groupTasks(visibleTasks)
  const activeTasks = visibleTasks.filter((task) =>
    ['running', 'queued', 'verifying'].includes(task.status),
  )
  const todoSectionTasks = visibleTasks.filter((task) => task.status === 'todo')
  const todoTasks = visibleTasks.filter((task) => task.status === 'todo')
  const activeSelected = new Set(
    [...selected].filter((id) => todoTasks.some((task) => task.id === id)),
  )
  const oldest = oldestWaitingSince(visibleTasks)
  const attentionCount = visibleTasks.filter((task) => task.attention !== 'none').length

  const startSelecting = () => {
    setFilter('todo')
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
    <div
      data-testid="mobile-board"
      className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-3"
    >
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
              <Button
                size="sm"
                variant="tertiary"
                isDisabled={todoTasks.length === 0}
                onPress={selectAll}
              >
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
              {onCreateTask ? (
                <Button size="sm" variant="primary" onPress={onCreateTask}>
                  新建任务
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" onPress={onOpenSupervisor}>
                让总管建任务
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={needsMe ? 'primary' : 'tertiary'}
          aria-pressed={needsMe}
          isDisabled={selecting}
          onPress={() => setNeedsMe((value) => !value)}
        >
          需要我
        </Button>
        <Input
          aria-label="搜索任务"
          placeholder="搜索标题"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          fullWidth
          className="min-w-40 flex-1"
        />
      </div>

      <div role="tablist" aria-label="任务筛选" className="mb-3 flex gap-1 overflow-x-auto">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            disabled={selecting}
            onClick={() => setFilter(item.id)}
            className={`min-h-11 shrink-0 rounded-full border px-3 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 ${
              filter === item.id ? 'border-accent text-accent' : 'border-separator text-muted'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {showAttention
        ? ATTENTION_GROUPS.map((group) => {
            const groupTasksList = visibleTasks.filter((task) => task.attention === group.id)
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
          tasks={activeTasks}
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
          tasks={todoSectionTasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
          empty="没有待办任务"
          selecting={selecting}
          selected={activeSelected}
          onToggle={toggle}
        />
      ) : null}

      {showDone ? (
        <section className="mb-4" data-mobile-section="已完成">
          <button
            type="button"
            aria-expanded={doneOpen}
            onClick={() => setDoneOpen((open) => !open)}
            className="flex min-h-11 w-full items-center justify-between rounded-lg border border-separator px-3 text-left text-xs font-medium text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span>已完成 ({grouped.done.length + grouped.closed.length})</span>
            <span>{doneOpen ? '收起' : '展开'}</span>
          </button>
          {doneOpen ? (
            grouped.done.length + grouped.closed.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-separator p-3 text-xs text-muted">
                没有已完成任务
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {[...grouped.done, ...grouped.closed].map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    selected={selecting ? selected.has(task.id) : task.id === selectedTaskId}
                    selectable={false}
                    stale={isStale(task.waitingSince, Date.now())}
                    onSelect={onSelectTask}
                    onToggle={toggle}
                  />
                ))}
              </div>
            )
          ) : null}
        </section>
      ) : null}

      {!selecting ? (
        <p className="mt-4 text-xs text-muted">待办任务可进入“选择待办”批量开工。</p>
      ) : null}
    </div>
  )
}
