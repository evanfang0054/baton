import type { Node, TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { X } from 'lucide-react'
import { BOARD_COLUMNS, groupTasks, type BoardColumnId } from './columns'
import { TaskCard } from './TaskCard'

interface TaskBoardProps {
  tasks: TaskSummary[]
  agentNodes: Node[]
  selectedTaskId: string | null
  expanded: boolean
  pinned: boolean
  onSelectTask: (taskId: string) => void
  onClose: () => void
}

export function TaskBoard({
  tasks,
  agentNodes,
  selectedTaskId,
  expanded,
  pinned,
  onSelectTask,
  onClose,
}: TaskBoardProps) {
  if (!expanded && !pinned) return null
  const grouped = groupTasks(tasks)
  const taskNodeIds = new Set(tasks.map((task) => task.nodeId).filter(Boolean))
  const unplanned = agentNodes.filter((node) => node.type === 'agent' && !taskNodeIds.has(node.id))

  const board = (
    <section id="task-board" className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-separator px-3">
        <span className="text-sm font-medium">任务看板</span>
        <Button variant="ghost" aria-label="关闭看板" onPress={onClose} className="h-8 w-8 p-0">
          <X size={16} />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {BOARD_COLUMNS.map((column) => (
          <BoardColumn
            key={column.id}
            column={column.id}
            label={column.label}
            tasks={column.id === 'unplanned' ? [] : grouped[column.id]}
            unplanned={column.id === 'unplanned' ? unplanned : []}
            selectedTaskId={selectedTaskId}
            onSelectTask={onSelectTask}
          />
        ))}
      </div>
    </section>
  )

  if (pinned) {
    return <div className="w-[560px] shrink-0 border-r border-separator">{board}</div>
  }

  return (
    <div className="fixed bottom-0 left-16 top-14 z-30 w-[min(960px,72vw)] border-r border-separator shadow-overlay">
      {board}
    </div>
  )
}

function BoardColumn({
  column,
  label,
  tasks,
  unplanned,
  selectedTaskId,
  onSelectTask,
}: {
  column: BoardColumnId
  label: string
  tasks: TaskSummary[]
  unplanned: Node[]
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
}) {
  return (
    <div className="flex w-70 shrink-0 flex-col gap-2" data-column={column}>
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="font-medium text-foreground">{label}</span>
        <span>{tasks.length + unplanned.length}</span>
      </div>
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          selected={task.id === selectedTaskId}
          onSelect={onSelectTask}
        />
      ))}
      {unplanned.map((node) => (
        <div
          key={node.id}
          className="rounded-lg border border-dashed border-separator p-3 text-xs text-muted"
        >
          {node.type === 'agent' ? node.data.title : node.id}
        </div>
      ))}
      {tasks.length === 0 && unplanned.length === 0 ? (
        <div className="rounded-lg border border-dashed border-separator p-3 text-xs text-muted">
          暂无任务
        </div>
      ) : null}
    </div>
  )
}
