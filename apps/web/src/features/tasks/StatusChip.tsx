import type { TaskStatus } from '@baton/protocol'
import { Chip } from '@heroui/react/chip'

const labels: Record<TaskStatus, string> = {
  todo: '待办',
  queued: '排队中',
  running: '进行中',
  waiting_input: '待审核',
  verifying: '验收中',
  review: '待验收',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export function StatusChip({ status }: { status: TaskStatus }) {
  const color =
    status === 'done'
      ? 'success'
      : status === 'failed'
        ? 'danger'
        : status === 'waiting_input'
          ? 'warning'
          : status === 'review'
            ? 'accent'
            : 'default'
  return (
    <Chip variant="soft" color={color} size="sm">
      {labels[status]}
    </Chip>
  )
}
