import type { DeliverySummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DeliveryCard } from './DeliveryCard'

export function DeliveryRail({
  deliveries,
  activeDeliveryId,
  onCreate,
  onSelect,
  onOpenBoard,
}: {
  deliveries: DeliverySummary[]
  activeDeliveryId: string | null
  onCreate: () => void
  onSelect: (deliveryId: string) => void
  onOpenBoard: () => void
}) {
  const [needsMe, setNeedsMe] = useState(false)
  const visible = useMemo(
    () =>
      deliveries
        .filter((delivery) =>
          needsMe ? delivery.status === 'waiting_person' || delivery.status === 'blocked' : true,
        )
        .sort((a, b) => (a.waitingSince ?? Infinity) - (b.waitingSince ?? Infinity)),
    [deliveries, needsMe],
  )
  const waiting = deliveries.filter(
    (delivery) => delivery.status === 'waiting_person' || delivery.status === 'blocked',
  ).length

  return (
    <aside
      aria-label="交付列表"
      className="flex w-72 shrink-0 flex-col border-r border-separator bg-surface"
    >
      <div className="flex items-center gap-2 border-b border-separator px-3 py-2">
        <span className="text-xs font-medium text-muted">交付</span>
        <button
          type="button"
          onClick={() => setNeedsMe(!needsMe)}
          aria-pressed={needsMe}
          className={`rounded px-1.5 py-0.5 text-[11px] ${
            needsMe ? 'bg-warning/10 text-warning' : 'text-muted hover:text-foreground'
          }`}
        >
          需要我 {waiting}
        </button>
        <Button size="sm" variant="tertiary" className="ml-auto" onPress={onOpenBoard}>
          看板
        </Button>
        <Button size="sm" variant="primary" isIconOnly aria-label="新建交付" onPress={onCreate}>
          <Plus size={14} aria-hidden="true" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {visible.map((delivery) => (
          <div
            key={delivery.id}
            className={
              activeDeliveryId === delivery.id ? 'rounded-lg ring-1 ring-accent' : undefined
            }
          >
            <DeliveryCard delivery={delivery} compact onSelect={onSelect} />
          </div>
        ))}
        {visible.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted">
            {deliveries.length === 0 ? '还没有交付' : '没有需要我处理的交付'}
          </p>
        ) : null}
      </div>
    </aside>
  )
}
