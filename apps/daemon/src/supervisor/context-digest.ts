import { buildTaskContextDigest } from '@baton/core'
import type { PlanContextItem, PlanItem } from '@baton/protocol'
import { getTaskDetail, listAudit, listTasks } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import type { FailureService } from '../failures/service.js'

/** 建单上下文摘要：只读任务元数据与失败摘要，不含 transcript/文件正文。 */
export function createContextDigest(deps: {
  db: Db
  failures: FailureService
  now: () => number
}) {
  return function buildContextDigest(workspaceId: string, items: PlanItem[]): PlanContextItem[] {
    const tasks = listTasks(deps.db, { workspaceId })
    const failures = deps.failures.latestByTaskIds(tasks.map((task) => task.id))
    const handoffAudits = listAudit(deps.db, { actionPrefix: 'task.handoff.create', limit: 100 })
    const handoffByTask = new Map(
      handoffAudits.map((entry) => {
        const detail = entry.detail as { taskId?: string; nodeId?: string }
        return [detail.taskId ?? '', detail.nodeId ?? ''] as const
      }),
    )
    const handoffNodeIds = new Set(handoffByTask.values())
    const targetNodeId = items[0]?.targetNodeId ?? null
    const contextIds = new Set(items.flatMap((item) => item.contextNodeIds))
    const titleTokens = (items[0]?.title ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length >= 2)
    const candidates: PlanContextItem[] = []
    for (const task of tasks.slice(0, 50)) {
      const detail = getTaskDetail(deps.db, task.id)?.task
      const includedIds = new Set(detail?.context?.included.map((item) => item.id) ?? [])
      if (targetNodeId && task.nodeId === targetNodeId) {
        candidates.push({
          taskId: task.id,
          title: task.title,
          status: task.status,
          source: 'same_agent',
          failure: null,
        })
      }
      const isHandoff =
        handoffByTask.has(task.id) ||
        [...handoffNodeIds].some((nodeId) => includedIds.has(nodeId))
      if (isHandoff) {
        candidates.push({
          taskId: task.id,
          title: task.title,
          status: task.status,
          source: 'handoff',
          failure: null,
        })
      }
      if ([...contextIds].some((id) => includedIds.has(id))) {
        candidates.push({
          taskId: task.id,
          title: task.title,
          status: task.status,
          source: 'context_node',
          failure: null,
        })
      }
      if (failures.has(task.id)) {
        candidates.push({
          taskId: task.id,
          title: task.title,
          status: task.status,
          source: 'recent_failure',
          failure: failures.get(task.id)?.summary ?? null,
        })
      }
      if (titleTokens.some((token) => task.title.toLowerCase().includes(token))) {
        candidates.push({
          taskId: task.id,
          title: task.title,
          status: task.status,
          source: 'title',
          failure: null,
        })
      }
    }
    return buildTaskContextDigest({ candidates })
  }
}
