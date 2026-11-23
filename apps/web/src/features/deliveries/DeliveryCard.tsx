import { canCancelDeliveryStatus } from '@baton/core'
import type { DeliverySummary } from '@baton/protocol'
import {
  DELIVERY_STATUS_LABELS,
  STAGE_STATUS_LABELS,
  deliveryStatusTone,
  formatWaiting,
  isStaleWaiting,
} from './delivery-labels'

const chipBase = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium'
const stopButtonClass = [
  'pointer-events-auto relative z-20 ml-auto rounded border border-danger/40 px-1.5 py-0.5 text-danger',
  'transition-colors hover:bg-danger/10 focus-visible:outline-2',
  'focus-visible:outline-offset-1 focus-visible:outline-accent',
].join(' ')

function stageTone(status: string): string {
  if (status === 'done') return 'bg-success/10 text-success'
  if (status === 'running') return 'bg-accent/10 text-accent'
  if (status === 'waiting_person') return 'bg-warning/10 text-warning'
  if (status === 'failed') return 'bg-danger/10 text-danger'
  return 'bg-default text-muted'
}

export function DeliveryCard({
  delivery,
  compact = false,
  onSelect,
  onCancel,
}: {
  delivery: DeliverySummary
  compact?: boolean
  onSelect: (deliveryId: string) => void
  onCancel?: (deliveryId: string) => void
}) {
  const stale = isStaleWaiting(delivery.waitingSince)
  return (
    <div
      className={[
        'relative w-full rounded-lg border border-separator bg-surface p-3 text-left transition-colors',
        'hover:border-accent/50 hover:bg-default/40',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={() => onSelect(delivery.id)}
        className="absolute inset-0 z-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-label={`打开交付 ${delivery.title}`}
      />
      <div className="pointer-events-none relative z-10">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{delivery.title}</p>
            {!compact ? (
              <p className="mt-1 line-clamp-2 text-xs text-muted">{delivery.goal}</p>
            ) : null}
          </div>
          <span className={`shrink-0 text-xs ${deliveryStatusTone(delivery.status)}`}>
            {DELIVERY_STATUS_LABELS[delivery.status]}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {delivery.stages.map((stage) => (
            <span
              key={stage.key}
              className={`${chipBase} ${stageTone(stage.status)}`}
              title={`${stage.ordinal} ${stage.label}：${STAGE_STATUS_LABELS[stage.status]}`}
            >
              <span aria-hidden="true">{stage.ordinal}</span>
              {stage.label}
            </span>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>
            {delivery.stageProgress.done}/{delivery.stageProgress.total} 阶段
          </span>
          {delivery.waitingSince ? (
            <span className={stale ? 'text-warning' : undefined}>
              等待 {formatWaiting(delivery.waitingSince)}
              {stale ? ' · 超过 30 分钟' : ''}
            </span>
          ) : null}
          {delivery.openAnnotationCount > 0 ? (
            <span>{delivery.openAnnotationCount} 条标注</span>
          ) : null}
          {delivery.attention !== 'none' ? <span className="text-warning">需要老板</span> : null}
          {onCancel && canCancelDeliveryStatus(delivery.status) ? (
            <button
              type="button"
              onClick={() => onCancel(delivery.id)}
              className={stopButtonClass}
              aria-label={`停止交付 ${delivery.title}`}
            >
              停止交付
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
