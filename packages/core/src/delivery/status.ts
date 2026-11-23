import type { DeliveryStatus, StageStatus, TaskStatus } from '@baton/protocol'

export function deriveStageStatus(taskStatus: TaskStatus | null): StageStatus {
  if (taskStatus === null || taskStatus === 'todo') return 'pending'
  if (taskStatus === 'queued' || taskStatus === 'running' || taskStatus === 'verifying') {
    return 'running'
  }
  if (taskStatus === 'waiting_input' || taskStatus === 'review') return 'waiting_person'
  if (taskStatus === 'done') return 'done'
  if (taskStatus === 'failed') return 'failed'
  return 'cancelled'
}

export function deriveDeliveryStatus(input: {
  cancelled: boolean
  stages: Array<{ key: string; status: StageStatus }>
}): DeliveryStatus {
  if (input.cancelled) return 'cancelled'
  const statuses = input.stages.map((stage) => stage.status)
  // 任一阶段被取消，交付就不可能完成；继续展示后续 pending 阶段会让人误以为还在推进。
  if (statuses.some((status) => status === 'cancelled')) return 'cancelled'
  if (statuses.length > 0 && statuses.every((status) => status === 'done')) return 'done'
  if (statuses.some((status) => status === 'waiting_person')) return 'waiting_person'
  if (
    statuses.some(
      (status, index) => status === 'pending' && index > 0 && statuses[index - 1] === 'done',
    )
  ) {
    return 'waiting_person'
  }
  if (statuses.some((status) => status === 'running')) return 'running'
  if (statuses.some((status) => status === 'failed')) return 'blocked'
  if (statuses.every((status) => status === 'pending')) return 'draft'
  return 'running'
}

export function deriveCurrentStageKey(
  stages: Array<{ key: string; status: StageStatus }>,
): string | null {
  // 交付已因阶段取消而终止时，没有“当前阶段”。
  if (stages.some((stage) => stage.status === 'cancelled')) return null
  return (
    stages.find((stage) => stage.status !== 'done' && stage.status !== 'cancelled')?.key ?? null
  )
}
