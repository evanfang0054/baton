import type { DeliveryStatus, StageStatus } from '@baton/protocol'

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  draft: '草稿',
  running: '进行中',
  waiting_person: '待我处理',
  blocked: '已阻断',
  done: '已交付',
  cancelled: '已取消',
}

export const DELIVERY_STATUS_ORDER: DeliveryStatus[] = [
  'draft',
  'running',
  'waiting_person',
  'blocked',
  'done',
  'cancelled',
]

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  pending: '待开始',
  running: '进行中',
  waiting_person: '待人处理',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export function deliveryStatusTone(status: DeliveryStatus): string {
  if (status === 'running') return 'text-accent'
  if (status === 'waiting_person') return 'text-warning'
  if (status === 'blocked') return 'text-danger'
  if (status === 'done') return 'text-success'
  if (status === 'cancelled') return 'text-muted'
  return 'text-muted'
}

export function formatWaiting(since: number | null, now = Date.now()): string {
  if (!since) return '—'
  const minutes = Math.max(0, Math.floor((now - since) / 60_000))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  return `${Math.floor(hours / 24)} 天`
}

export function isStaleWaiting(since: number | null, now = Date.now()): boolean {
  return since !== null && now - since > 30 * 60_000
}
