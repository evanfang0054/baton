import type { TaskSummary } from '@baton/protocol'
import { statusColumn, type BoardColumnId } from './columns'

const TERMINAL = new Set<TaskSummary['status']>(['done', 'failed', 'cancelled'])

/** 拖拽目标列对应的领域命令；none 表示该目标不允许手动拖入。 */
export type TaskDropAction =
  | { kind: 'enqueue' }
  | { kind: 'retry' }
  | { kind: 'reopen' }
  | { kind: 'approve' }
  | { kind: 'cancel' }
  | { kind: 'none'; reason: string }

/**
 * 看板列不是任务状态本身：queued 归“待办”、verifying 归“进行中”。
 * 这里只把用户拖拽意图翻译成已有命令，绝不直接写 task.status。
 */
export function taskDropAction(task: TaskSummary, column: BoardColumnId): TaskDropAction {
  if (column === statusColumn(task.status)) {
    return { kind: 'none', reason: '任务已经在这一列' }
  }
  switch (column) {
    case 'closed':
      return TERMINAL.has(task.status)
        ? { kind: 'none', reason: '任务已经是结束状态' }
        : { kind: 'cancel' }
    case 'done':
      return task.status === 'review'
        ? { kind: 'approve' }
        : { kind: 'none', reason: '只有待验收任务可以拖到已完成' }
    case 'running':
      if (task.status === 'queued') {
        return { kind: 'none', reason: '任务已排队，会自动开始' }
      }
      if (
        task.status === 'todo' ||
        (task.status === 'waiting_input' && task.waitingReason === 'stalled')
      ) {
        return { kind: 'enqueue' }
      }
      if (task.status === 'failed') return { kind: 'retry' }
      if (task.status === 'done' || task.status === 'cancelled') {
        return { kind: 'none', reason: '请先拖到待办重新打开，再拖到进行中' }
      }
      return { kind: 'none', reason: '只有待办、停滞或失败的任务可以拖到进行中' }
    case 'todo':
      if (task.status === 'failed') return { kind: 'retry' }
      if (task.status === 'done' || task.status === 'cancelled') return { kind: 'reopen' }
      if (task.status === 'waiting_input' && task.waitingReason === 'stalled') {
        return { kind: 'enqueue' }
      }
      return { kind: 'none', reason: '只有已完成、已取消、失败或停滞的任务可以拖回待办' }
    case 'waiting':
    case 'review':
      return { kind: 'none', reason: '该状态由 Agent 执行推进，不能手动拖入' }
    case 'unplanned':
      return { kind: 'none', reason: '未规划列只放 Agent 节点' }
  }
}

export function isDroppable(task: TaskSummary, column: BoardColumnId): boolean {
  return column !== statusColumn(task.status) && taskDropAction(task, column).kind !== 'none'
}
