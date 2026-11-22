import type { TaskStatus } from '@baton/protocol'

export type EnqueueGuard =
  { ok: true; stageKey: string } | { ok: false; reason: 'cancelled' | 'no_stage' | 'not_todo' }

export function canEnqueueDelivery(input: {
  cancelledAt: number | null
  stages: Array<{ key: string; taskStatus: TaskStatus | null }>
}): EnqueueGuard {
  if (input.cancelledAt !== null) return { ok: false, reason: 'cancelled' }
  const stage = input.stages.find(
    (item) => item.taskStatus !== 'done' && item.taskStatus !== 'cancelled',
  )
  if (!stage) return { ok: false, reason: 'no_stage' }
  if (stage.taskStatus !== 'todo') return { ok: false, reason: 'not_todo' }
  return { ok: true, stageKey: stage.key }
}

export type CancelGuard = { ok: true } | { ok: false; reason: 'cancelled' | 'done' }

export function canCancelDelivery(input: {
  cancelledAt: number | null
  statuses: TaskStatus[]
}): CancelGuard {
  if (input.cancelledAt !== null) return { ok: false, reason: 'cancelled' }
  if (input.statuses.length > 0 && input.statuses.every((status) => status === 'done')) {
    return { ok: false, reason: 'done' }
  }
  return { ok: true }
}
