import type { Node, TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { toast } from '@heroui/react/toast'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState } from 'react'
import { useCommand } from '../../lib/command-context'
import { BOARD_COLUMNS, groupTasks, type BoardColumnId } from './columns'
import { TaskCard } from './TaskCard'

const BATCH_LIMIT = 20

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
  const send = useCommand()
  const queryClient = useQueryClient()
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batching, setBatching] = useState(false)

  if (!expanded && !pinned) return null
  const grouped = groupTasks(tasks)
  const taskNodeIds = new Set(tasks.map((task) => task.nodeId).filter(Boolean))
  const unplanned = agentNodes.filter((node) => node.type === 'agent' && !taskNodeIds.has(node.id))
  const todoTasks = tasks.filter((task) => task.status === 'todo')

  const exitSelection = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  const toggle = (taskId: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(taskId)) {
        next.delete(taskId)
      } else if (next.size < BATCH_LIMIT) {
        next.add(taskId)
      }
      return next
    })
  }

  const selectAll = () => {
    setSelected(new Set(todoTasks.slice(0, BATCH_LIMIT).map((task) => task.id)))
  }

  const startBatch = async () => {
    if (batching || selected.size === 0) return
    setBatching(true)
    let started = 0
    let failed = 0
    for (const taskId of selected) {
      try {
        await send({ type: 'task.enqueue', payload: { taskId } })
        started += 1
      } catch {
        failed += 1
      }
    }
    setBatching(false)
    await queryClient.invalidateQueries({ queryKey: ['tasks'] })
    if (failed > 0) {
      toast.danger(`已开工 ${started} 个，${failed} 个失败`)
    } else {
      toast.success(`已开工 ${started} 个`)
    }
    exitSelection()
  }

  const board = (
    <section id="task-board" className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-separator px-3 py-1.5">
        <span className="text-sm font-medium">任务看板</span>
        <div className="flex items-center gap-1">
          {selecting ? (
            <>
              <Button
                variant="tertiary"
                size="sm"
                isDisabled={todoTasks.length === 0 || batching}
                onPress={selectAll}
              >
                全选待办
              </Button>
              <Button variant="tertiary" size="sm" isDisabled={batching} onPress={exitSelection}>
                取消
              </Button>
              <Button
                variant="primary"
                size="sm"
                isDisabled={selected.size === 0 || selected.size > BATCH_LIMIT || batching}
                onPress={() => void startBatch()}
              >
                开工 {selected.size} 个
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              isDisabled={todoTasks.length === 0}
              onPress={() => {
                setSelecting(true)
                setSelected(new Set())
              }}
            >
              批量开工
            </Button>
          )}
          <Button variant="ghost" aria-label="关闭看板" onPress={onClose} className="h-8 w-8 p-0">
            <X size={16} />
          </Button>
        </div>
      </header>
      {selecting ? (
        <p className="shrink-0 border-b border-separator px-3 py-1 text-xs text-muted">
          仅待办任务可开工，最多 {BATCH_LIMIT} 个。
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {BOARD_COLUMNS.map((column) => (
          <BoardColumn
            key={column.id}
            column={column.id}
            label={column.label}
            tasks={column.id === 'unplanned' ? [] : grouped[column.id]}
            unplanned={column.id === 'unplanned' ? unplanned : []}
            selectedTaskId={selectedTaskId}
            selecting={selecting}
            selected={selected}
            onToggle={toggle}
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
  selecting,
  selected,
  onToggle,
  onSelectTask,
}: {
  column: BoardColumnId
  label: string
  tasks: TaskSummary[]
  unplanned: Node[]
  selectedTaskId: string | null
  selecting: boolean
  selected: Set<string>
  onToggle: (taskId: string) => void
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
          selected={selecting ? selected.has(task.id) : task.id === selectedTaskId}
          selectable={selecting}
          onSelect={onSelectTask}
          onToggle={onToggle}
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
