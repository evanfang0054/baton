import type { Attention, TaskStatus } from '@baton/protocol'

export type BoardColumnId =
  'unplanned' | 'todo' | 'running' | 'waiting' | 'review' | 'done' | 'closed'

/** 内部 9 态对外压成 7 列；`unplanned` 只用于没有 task 的 Agent 节点。 */
export function boardColumn(status: TaskStatus): BoardColumnId {
  switch (status) {
    case 'todo':
    case 'queued':
      return 'todo'
    case 'running':
    case 'verifying':
      return 'running'
    case 'waiting_input':
      return 'waiting'
    case 'review':
      return 'review'
    case 'done':
      return 'done'
    case 'cancelled':
    case 'failed':
      return 'closed'
  }
}

/** 总管“谁在等我”和看板共用同一口径：attention 或人闸门状态。 */
export function needsPerson(input: { status: TaskStatus; attention: Attention }): boolean {
  return input.attention !== 'none' || input.status === 'waiting_input' || input.status === 'review'
}

/** 只对等待人处理的状态返回等待起点；其他状态不显示“已等多久”。 */
export function waitingSinceFor(task: { status: TaskStatus; updatedAt: number }): number | null {
  return task.status === 'waiting_input' || task.status === 'review' ? task.updatedAt : null
}
