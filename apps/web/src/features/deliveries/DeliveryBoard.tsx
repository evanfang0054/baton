import type { DeliverySummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { useMemo, useState } from 'react'
import { DeliveryCard } from './DeliveryCard'
import {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_ORDER,
  formatWaiting,
  isStaleWaiting,
} from './delivery-labels'

export type DeliveryFilter = 'all' | 'needs_me'

export function filterDeliveries(
  deliveries: DeliverySummary[],
  input: { filter: DeliveryFilter; query: string },
): DeliverySummary[] {
  const query = input.query.trim().toLowerCase()
  return deliveries
    .filter((delivery) => {
      if (query && !delivery.title.toLowerCase().includes(query)) return false
      if (input.filter === 'needs_me') {
        return delivery.status === 'waiting_person' || delivery.status === 'blocked'
      }
      return true
    })
    .sort((a, b) => (a.waitingSince ?? Infinity) - (b.waitingSince ?? Infinity))
}

export function DeliveryBoard({
  deliveries,
  onSelect,
  onOpenTaskView,
}: {
  deliveries: DeliverySummary[]
  onSelect: (deliveryId: string) => void
  onOpenTaskView?: () => void
}) {
  const [filter, setFilter] = useState<DeliveryFilter>('all')
  const [query, setQuery] = useState('')
  const visible = useMemo(
    () => filterDeliveries(deliveries, { filter, query }),
    [deliveries, filter, query],
  )
  const columns = DELIVERY_STATUS_ORDER.map((status) => ({
    status,
    items: visible.filter((delivery) => delivery.status === status),
  }))
  const needsMe = deliveries.filter(
    (delivery) => delivery.status === 'waiting_person' || delivery.status === 'blocked',
  ).length
  const stale = deliveries.filter((delivery) => isStaleWaiting(delivery.waitingSince)).length

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="交付看板">
      <div className="flex flex-wrap items-center gap-2 border-b border-separator px-4 py-2">
        <div role="group" aria-label="交付筛选" className="flex gap-1">
          <Button
            size="sm"
            variant={filter === 'all' ? 'primary' : 'tertiary'}
            onPress={() => setFilter('all')}
          >
            全部 {deliveries.length}
          </Button>
          <Button
            size="sm"
            variant={filter === 'needs_me' ? 'primary' : 'tertiary'}
            onPress={() => setFilter('needs_me')}
          >
            需要我 {needsMe}
          </Button>
        </div>
        <Input
          aria-label="搜索交付"
          placeholder="搜索交付标题"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-64"
          fullWidth
        />
        {stale > 0 ? (
          <span className="text-xs text-warning">{stale} 条等待超过 30 分钟</span>
        ) : null}
        {onOpenTaskView ? (
          <Button size="sm" variant="tertiary" className="ml-auto" onPress={onOpenTaskView}>
            任务视图
          </Button>
        ) : null}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 lg:grid-cols-3 xl:grid-cols-6">
        {columns.map((column) => (
          <div key={column.status} className="flex min-h-0 flex-col rounded-lg bg-default/20 p-2">
            <div className="mb-2 flex items-center justify-between px-1 text-xs">
              <span className="font-medium text-foreground">
                {DELIVERY_STATUS_LABELS[column.status]}
              </span>
              <span className="text-muted">{column.items.length}</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              {column.items.map((delivery) => (
                <DeliveryCard key={delivery.id} delivery={delivery} onSelect={onSelect} />
              ))}
              {column.items.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-muted">暂无</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {deliveries.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-lg border border-dashed border-separator bg-surface px-6 py-4 text-sm text-muted">
            还没有交付。在左侧点“新建交付”，把第一条需求放到画布上。
          </p>
        </div>
      ) : null}
      {visible.length === 0 && deliveries.length > 0 ? (
        <p className="px-4 pb-4 text-xs text-muted">没有匹配的交付。</p>
      ) : null}
      <p className="sr-only">
        当前最先等待的交付：
        {visible[0] ? `${visible[0].title}（${formatWaiting(visible[0].waitingSince)}）` : '无'}
      </p>
    </section>
  )
}
