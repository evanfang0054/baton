import type { TaskSummary } from '@baton/protocol'
import { Chip } from '@heroui/react/chip'
import { AttentionBadge } from './AttentionBadge'
import { StatusChip } from './StatusChip'
import { WaitingTime } from './WaitingTime'

interface TaskCardProps {
  task: TaskSummary
  selected?: boolean
  selectable?: boolean
  onSelect: (taskId: string) => void
  onToggle?: (taskId: string) => void
}

const cardClass = [
  'w-full rounded-lg border bg-surface p-3 text-left transition-colors',
  'hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent',
].join(' ')

export function TaskCard({
  task,
  selected = false,
  selectable = false,
  onSelect,
  onToggle,
}: TaskCardProps) {
  const border = selected ? 'border-accent' : 'border-separator'
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm font-medium">{task.title}</span>
        <AttentionBadge attention={task.attention} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <StatusChip status={task.status} />
        <Chip size="sm" variant="soft" color="default">
          {task.engine}
        </Chip>
        {task.retryCount > 0 ? <span>重试 {task.retryCount}</span> : null}
      </div>
      {task.waitingSince ? (
        <div className="mt-2">
          <WaitingTime since={task.waitingSince} />
        </div>
      ) : null}
    </>
  )

  if (!selectable) {
    return (
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(task.id)}
        className={`${cardClass} ${border}`}
      >
        {body}
      </button>
    )
  }

  // 只有待办任务能被批量开工；其他状态保持只读，避免误触。
  if (task.status !== 'todo') {
    return <div className={`${cardClass} border-separator opacity-60`}>{body}</div>
  }

  return (
    <label className={`${cardClass} ${border} flex cursor-pointer items-start gap-2`}>
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
