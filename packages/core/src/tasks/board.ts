import type { Attention, TaskStatus, TaskSummary } from '@baton/protocol'

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

/**
 * 看板 rail 计数与“需要我”筛选必须共用这个口径，否则计数会小于列表长度。
 * 验收失败和超预算也算需要人，即使任务状态本身还没有进入 review。
 */
export function needsMe(input: {
  status: TaskStatus
  attention: Attention
  acceptance?: { counts: { fail: number } } | null
  budget?: { overBudget: boolean } | null
}): boolean {
  return (
    needsPerson(input) ||
    (input.acceptance?.counts.fail ?? 0) > 0 ||
    input.budget?.overBudget === true
  )
}

/** 只对等待人处理的状态返回等待起点；其他状态不显示“已等多久”。 */
export function waitingSinceFor(task: { status: TaskStatus; updatedAt: number }): number | null {
  return task.status === 'waiting_input' || task.status === 'review' ? task.updatedAt : null
}

export const STALE_THRESHOLD_MS = 30 * 60 * 1000

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['done', 'failed', 'cancelled'])

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
  if (column === boardColumn(task.status)) {
    return { kind: 'none', reason: '任务已经在这一列' }
  }
  switch (column) {
    case 'closed':
      return TERMINAL_STATUSES.has(task.status)
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
  return column !== boardColumn(task.status) && taskDropAction(task, column).kind !== 'none'
}

/** 等待超过阈值（含边界）才算 stale；null 永远不 stale。 */
export function isStale(
  waitingSince: number | null,
  now: number,
  thresholdMs = STALE_THRESHOLD_MS,
): boolean {
  return waitingSince !== null && waitingSince <= now - thresholdMs
}

/** 等最久优先；没有等待的任务排后面，保持稳定顺序。 */
export function sortByWaiting<T extends { waitingSince: number | null }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.waitingSince === null && b.waitingSince === null) return 0
    if (a.waitingSince === null) return 1
    if (b.waitingSince === null) return -1
    return a.waitingSince - b.waitingSince
  })
}
