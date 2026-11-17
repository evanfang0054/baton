import type { TaskSummary } from '@baton/protocol'
import { AttentionBadge } from './AttentionBadge'
import { StatusChip } from './StatusChip'

export function TaskSummaryCard({ task }: { task: TaskSummary }) {
  return (
    <div className="rounded-lg border border-separator bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{task.title}</p>
        <AttentionBadge attention={task.attention} />
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <StatusChip status={task.status} />
        <span>{task.engine}</span>
      </div>
    </div>
  )
}
