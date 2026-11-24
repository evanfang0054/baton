import { attentionFor, needsPerson, waitingSinceFor } from '@baton/core'
import type { AttentionInboxItem } from '@baton/protocol'
import { listAcceptanceSummaries } from '../db/acceptance-repository.js'
import { getDelivery } from '../db/delivery-repositories.js'
import { listTasks, listWorkspaces } from '../db/repositories.js'
import type { Db } from '../db/types.js'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export interface AttentionService {
  list(limit?: number): { items: AttentionInboxItem[]; total: number }
}

export function createAttentionService(deps: { db: Db; now: () => number }): AttentionService {
  function list(limit = DEFAULT_LIMIT): { items: AttentionInboxItem[]; total: number } {
    const bounded = Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT)
    const rows: Array<{ item: AttentionInboxItem; updatedAt: number }> = []

    for (const workspace of listWorkspaces(deps.db)) {
      const tasks = listTasks(deps.db, { workspaceId: workspace.id }).filter(
        (task) => task.deliveryId,
      )
      if (tasks.length === 0) continue
      const acceptance = listAcceptanceSummaries(
        deps.db,
        tasks.map((task) => task.id),
      )
      for (const task of tasks) {
        const attention = attentionFor(task.status, task.waitingReason)
        const acceptanceFail = (acceptance.get(task.id)?.counts.fail ?? 0) > 0
        if (!needsPerson({ status: task.status, attention }) && !acceptanceFail) continue
        const delivery = task.deliveryId ? getDelivery(deps.db, task.deliveryId) : null
        if (!delivery) continue
        rows.push({
          item: {
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            deliveryId: delivery.id,
            deliveryTitle: delivery.title,
            stageKey: task.stageKey ?? null,
            taskId: task.id,
            title: task.title,
            kind: attention === 'none' ? 'acceptance' : attention,
            waitingSince: waitingSinceFor(task),
          },
          updatedAt: task.updatedAt,
        })
      }
    }

    rows.sort((a, b) => {
      const waitA = a.item.waitingSince ?? Number.MAX_SAFE_INTEGER
      const waitB = b.item.waitingSince ?? Number.MAX_SAFE_INTEGER
      return (
        waitA - waitB || b.updatedAt - a.updatedAt || a.item.taskId.localeCompare(b.item.taskId)
      )
    })

    return {
      items: rows.slice(0, bounded).map((row) => row.item),
      total: rows.length,
    }
  }

  return { list }
}
