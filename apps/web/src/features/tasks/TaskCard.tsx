import { isStale } from '@baton/core'
import type { TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { BadgeCheck, Clock } from 'lucide-react'
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AttentionBadge } from './AttentionBadge'
import { StatusChip } from './StatusChip'
import { WaitingTime } from './WaitingTime'

interface TaskCardProps {
  task: TaskSummary
  selected?: boolean
  selectable?: boolean
  stale?: boolean
  draggable?: boolean
  dragging?: boolean
  onSelect: (taskId: string) => void
  onToggle?: (taskId: string) => void
  onOpenScene?: (taskId: string) => void
  onDragPointerDown?: (event: ReactPointerEvent<HTMLDivElement>, task: TaskSummary) => void
}

const cardClass = [
  'w-full rounded-lg border bg-surface p-3 text-left transition-colors',
  'hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent',
].join(' ')

export function TaskCard({
  task,
  selected = false,
  selectable = false,
  stale = false,
  draggable = false,
  dragging = false,
  onSelect,
  onToggle,
  onOpenScene,
  onDragPointerDown,
}: TaskCardProps) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (task.waitingSince === null) return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [task.waitingSince])
  const isTaskStale = stale || isStale(task.waitingSince, now)
  const border = selected ? 'border-accent' : 'border-separator'
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm font-medium">{task.title}</span>
        {/* 「待验收」已经由 StatusChip 表达，attention badge 不再重复同一句话。 */}
        {task.attention === 'needs_review' ? null : <AttentionBadge attention={task.attention} />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <StatusChip status={task.status} />
        <Chip size="sm" variant="soft" color="default">
          {task.engine}
        </Chip>
        {task.retryCount > 0 ? <span>重试 {task.retryCount}</span> : null}
        {task.acceptance ? (
          <span className="inline-flex items-center gap-1">
            <BadgeCheck size={12} aria-hidden="true" />
            AC {task.acceptance.counts.pass}/{task.acceptance.counts.total}
          </span>
        ) : null}
      </div>
      {task.waitingSince ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <WaitingTime since={task.waitingSince} />
          {isTaskStale ? (
            <span className="inline-flex items-center gap-1 text-xs text-warning">
              <Clock size={12} aria-hidden="true" />· 超过 30 分钟
            </span>
          ) : null}
        </div>
      ) : isTaskStale ? (
        <p className="mt-2 flex items-center gap-1 text-xs text-warning">
          <Clock size={12} aria-hidden="true" />
          已等待超过 30 分钟
        </p>
      ) : null}
    </>
  )

  if (!selectable) {
    const dragClass = draggable ? 'cursor-grab select-none active:cursor-grabbing' : ''
    return (
      <div
        data-testid={`task-card-${task.id}`}
        data-dragging={dragging ? 'true' : undefined}
        className={`${cardClass} ${border} ${dragClass} ${dragging ? 'opacity-40' : ''}`}
        style={draggable ? { touchAction: 'pan-y' } : undefined}
        title={draggable ? '长按后拖拽到其他列可更改状态' : undefined}
        onPointerDown={
          draggable && onDragPointerDown ? (event) => onDragPointerDown(event, task) : undefined
        }
        onContextMenu={dragging ? (event) => event.preventDefault() : undefined}
      >
        <button
          type="button"
          aria-current={selected ? 'true' : undefined}
          onClick={() => onSelect(task.id)}
          className="block w-full rounded text-left focus-visible:outline-2 focus-visible:outline-accent"
        >
          {body}
        </button>
        {onOpenScene ? (
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="tertiary" onPress={() => onOpenScene(task.id)}>
              看现场
            </Button>
          </div>
        ) : null}
      </div>
    )
  }

  // 只有待办任务能被批量开工；其他状态保持只读，避免误触。
  if (task.status !== 'todo') {
    return (
      <div
        data-testid={`task-card-${task.id}`}
        className={`${cardClass} border-separator opacity-60`}
      >
        {body}
      </div>
    )
  }

  return (
    <label
      data-testid={`task-card-${task.id}`}
      className={`${cardClass} ${border} flex cursor-pointer items-start gap-2`}
    >
      <input
        type="checkbox"
        aria-label={`选择 ${task.title}`}
        checked={selected}
        onChange={() => onToggle?.(task.id)}
        className="mt-1 h-4 w-4 shrink-0"
      />
      <span className="min-w-0 flex-1">{body}</span>
    </label>
  )
}
