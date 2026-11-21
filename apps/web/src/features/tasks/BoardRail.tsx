import { Button } from '@heroui/react/button'
import { LayoutList, Pin, PinOff } from 'lucide-react'

interface BoardRailProps {
  counts: {
    needs_me: number
    needs_approval: number
    needs_reply: number
    needs_review: number
  }
  total: number
  expanded: boolean
  onToggle: () => void
  pinned: boolean
  onTogglePin: () => void
}

export function BoardRail({
  counts,
  total,
  expanded,
  onToggle,
  pinned,
  onTogglePin,
}: BoardRailProps) {
  const open = expanded || pinned
  return (
    <aside
      data-testid="board-rail"
      className="flex w-16 shrink-0 flex-col items-center gap-3 border-r border-separator py-3"
    >
      <Button
        variant="ghost"
        aria-label={open ? '收起看板' : '展开看板'}
        aria-expanded={open}
        aria-controls="task-board"
        onPress={onToggle}
        className="h-10 w-10 p-0"
      >
        <LayoutList size={18} />
      </Button>
      <RailCount label="需要我" value={counts.needs_me} tone="accent" />
      <RailCount label="待审批" value={counts.needs_approval} tone="warning" />
      <RailCount label="待回复" value={counts.needs_reply} tone="warning" />
      <RailCount label="待验收" value={counts.needs_review} tone="accent" />
      <RailCount label="总任务" value={total} tone="default" />
      <Button
        variant="ghost"
        aria-label={pinned ? '取消固定看板' : '固定看板'}
        onPress={onTogglePin}
        className="mt-auto h-10 w-10 p-0"
      >
        {pinned ? <PinOff size={18} /> : <Pin size={18} />}
      </Button>
      {open ? <span className="text-xs text-muted">B 收起</span> : null}
    </aside>
  )
}

function RailCount({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'warning' | 'accent' | 'default'
}) {
  const toneClass =
    tone === 'accent' ? 'text-accent' : tone === 'warning' ? 'text-warning' : 'text-foreground'
  return (
    <div className="flex flex-col items-center gap-1" title={label}>
      <span className={`text-sm font-semibold ${toneClass}`}>{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  )
}
