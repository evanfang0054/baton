import type { Attention, Task } from '@baton/protocol'
import { Chip } from '@heroui/react/chip'
import { AttentionBadge } from './AttentionBadge'
import { StatusChip } from './StatusChip'
import { WaitingTime } from './WaitingTime'

export function TaskHeader({
  task,
  attention,
  waitingSince,
}: {
  task: Task
  attention: Attention
  waitingSince: number | null
}) {
  return (
    <header className="shrink-0 border-b border-separator pb-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-medium text-foreground">{task.title}</h2>
        <AttentionBadge attention={attention} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <StatusChip status={task.status} />
        <Chip size="sm" variant="soft" color="default">
          {task.engine}
        </Chip>
        {task.dangerouslySkipPermissions ? (
          <Chip size="sm" variant="soft" color="danger">
            跳过权限确认
          </Chip>
        ) : null}
        {task.retryCount > 0 ? <span>重试 {task.retryCount}</span> : null}
        {waitingSince ? <WaitingTime since={waitingSince} /> : null}
      </div>
    </header>
  )
}
