import type { Attention } from '@baton/protocol'
import { Chip } from '@heroui/react/chip'
import { CheckSquare, CircleAlert, MessageSquare, ShieldAlert } from 'lucide-react'

const config: Record<
  Exclude<Attention, 'none'>,
  { label: string; color: 'warning' | 'accent'; icon: typeof ShieldAlert }
> = {
  needs_approval: { label: '待审批', color: 'warning', icon: ShieldAlert },
  needs_reply: { label: '待回复', color: 'warning', icon: MessageSquare },
  needs_attention: { label: '需关注', color: 'warning', icon: CircleAlert },
  needs_review: { label: '待验收', color: 'accent', icon: CheckSquare },
}

export function AttentionBadge({ attention }: { attention: Attention }) {
  if (attention === 'none') return null
  const item = config[attention]
  const Icon = item.icon
  return (
    <Chip variant="soft" color={item.color} size="sm">
      <span className="flex items-center gap-1">
        <Icon size={12} />
        {item.label}
      </span>
    </Chip>
  )
}
