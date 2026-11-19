import type { TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { groupTasks } from './columns'
import { TaskCard } from './TaskCard'

function Section({
  title,
  tasks,
  selectedTaskId,
  onSelectTask,
  empty,
}: {
  title: string
  tasks: TaskSummary[]
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
  empty: string
}) {
  return (
    <section className="mb-4">
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
              selected={task.id === selectedTaskId}
              onSelect={onSelectTask}
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
  const grouped = groupTasks(tasks)
  const attention = tasks.filter((task) => task.attention !== 'none')
  const done = [...grouped.done, ...grouped.closed]

  return (
    <div data-testid="mobile-board" className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 pt-3">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-base font-semibold">任务</h1>
        <Button size="sm" variant="secondary" onPress={onOpenSupervisor}>
          让总管建任务
        </Button>
      </header>

      <Section
        title="需要我处理"
        tasks={attention}
        selectedTaskId={selectedTaskId}
        onSelectTask={onSelectTask}
        empty="没有需要你处理的任务"
      />
      <Section
        title="进行中"
        tasks={grouped.running}
        selectedTaskId={selectedTaskId}
        onSelectTask={onSelectTask}
        empty="没有进行中的任务"
      />
      <Section
        title="待办"
        tasks={grouped.todo}
        selectedTaskId={selectedTaskId}
        onSelectTask={onSelectTask}
        empty="没有待办任务"
      />

      {done.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-muted">
            已完成/已取消 ({done.length})
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {done.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                selected={task.id === selectedTaskId}
                onSelect={onSelectTask}
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}
