import type { TaskStatus } from '@baton/protocol'
import { Chip } from '@heroui/react/chip'
import { Check, CheckSquare, Clock, LoaderCircle, MinusCircle, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'

const config: Record<
  TaskStatus,
  {
    label: string
    color: 'default' | 'accent' | 'warning' | 'success' | 'danger'
    icon?: ReactNode
  }
> = {
  todo: { label: '待办', color: 'default' },
  queued: { label: '排队中', color: 'default' },
  running: {
    label: '进行中',
    color: 'accent',
    icon: <LoaderCircle size={12} className="animate-spin" />,
  },
  verifying: {
    label: '验收中',
    color: 'accent',
    icon: <LoaderCircle size={12} className="animate-spin" />,
  },
  waiting_input: { label: '待处理', color: 'warning', icon: <Clock size={12} /> },
  review: { label: '待验收', color: 'accent', icon: <CheckSquare size={12} /> },
  done: { label: '已完成', color: 'success', icon: <Check size={12} /> },
  failed: { label: '失败', color: 'danger', icon: <XCircle size={12} /> },
  cancelled: { label: '已取消', color: 'default', icon: <MinusCircle size={12} /> },
}

export function StatusChip({ status }: { status: TaskStatus }) {
  const { label, color, icon } = config[status]
  return (
    <Chip variant="soft" color={color} size="sm">
      <span className={`flex items-center gap-1 ${status === 'cancelled' ? 'text-muted' : ''}`}>
        {icon}
        {label}
      </span>
    </Chip>
  )
}
