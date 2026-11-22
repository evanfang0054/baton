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
