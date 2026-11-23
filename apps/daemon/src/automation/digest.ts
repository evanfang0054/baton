import { attentionFor, buildAttentionItems, buildDigest, waitingSinceFor } from '@baton/core'
import { Notice } from '@baton/protocol'
import type { BroadcastEvent, EventStore } from '../db/event-store.js'
import { listAcceptanceSummaries } from '../db/acceptance-repository.js'
import {
  getReviewByTask,
  getSetting,
  getWorkspace,
  insertAudit,
  insertNotice,
  listApprovalsByTask,
  listAudit,
  listTasks,
  setSetting,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import type { FailureService } from '../failures/service.js'
import type { createSupervisorActionService } from '../supervisor/actions.js'
import { loadPolicy } from '../workspace/policy.js'
import { resolveWorkspaceDir } from '../workspace/resolver.js'
import type { Config } from '../config.js'
import { hashPolicy } from './version.js'

export type DigestTrigger = 'manual' | 'schedule' | 'attention'

export interface DigestServiceDeps {
  db: Db
  config: Config
  eventStore: EventStore
  broadcast: (event: BroadcastEvent) => void
  now: () => number
  newId: () => string
  actions?: ReturnType<typeof createSupervisorActionService>
  failures?: FailureService
}

export interface DigestService {
  generate(
    workspaceId: string,
    trigger: DigestTrigger,
    options?: { advanceWindow?: boolean },
  ): Notice | null
}

const WINDOW_MS = 12 * 60 * 60 * 1000

function lastDigestKey(workspaceId: string): string {
  return `digest:last:${workspaceId}`
}

export function createDigestService(deps: DigestServiceDeps): DigestService {
  function generate(
    workspaceId: string,
    trigger: DigestTrigger,
    options: { advanceWindow?: boolean } = {},
  ): Notice | null {
    deps.actions?.expire()
    deps.actions?.cleanup()
    const workspace = getWorkspace(deps.db, workspaceId)
    if (!workspace) {
      throw appError('workspace_not_found', 'workspace not found', { workspaceId })
    }
    const tasks = listTasks(deps.db, { workspaceId })
    if (trigger === 'schedule' && tasks.length === 0) return null

    const workspacePath = resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
    const policy = loadPolicy(workspacePath)
    const now = deps.now()
    const previous = getSetting(deps.db, lastDigestKey(workspaceId)) as { at?: number } | null
    const windowStart =
      typeof previous?.at === 'number' && Number.isFinite(previous.at)
        ? previous.at
        : now - WINDOW_MS

    const taskIds = new Set(tasks.map((task) => task.id))
    const autoDecisions = tasks.flatMap((task) =>
      listApprovalsByTask(deps.db, task.id)
        .filter(
          (item) => item.decidedBy === 'auto' && item.decidedAt !== null && item.decision !== null,
        )
        .map((item) => ({
          decision: item.decision as 'allow' | 'deny',
          decidedAt: item.decidedAt as number,
        })),
    )
    const retryAudits = listAudit(deps.db, { actionPrefix: 'task.retry', limit: 200 })
      .filter((entry) => taskIds.has(String((entry.detail as { taskId?: string }).taskId ?? '')))
      .map((entry) => ({ ts: entry.ts }))

    const completedAtByTask = new Map<string, number>()
    for (const task of tasks) {
      const review = getReviewByTask(deps.db, task.id)
      if (review?.verdict === 'approved' && review.decidedAt !== null) {
        completedAtByTask.set(task.id, review.decidedAt)
      }
    }

    const proposals = deps.actions?.listProposed(workspaceId) ?? []
    const proposalByTask = new Map(
      proposals.filter((action) => action.taskId).map((action) => [action.taskId!, action.id]),
    )
    const failures = deps.failures?.latestByTaskIds(tasks.map((task) => task.id)) ?? new Map()
    const acceptance = listAcceptanceSummaries(
      deps.db,
      tasks.map((task) => task.id),
    )
    const attention = buildAttentionItems({
      now,
      tasks: tasks.map((task) => ({
        taskId: task.id,
        title: task.title,
        status: task.status,
        attention: attentionFor(task.status, task.waitingReason),
        waitingReason: task.waitingReason,
        waitingSince: waitingSinceFor(task),
        updatedAt: task.updatedAt,
        acceptance: acceptance.get(task.id) ?? null,
        proposalId: proposalByTask.get(task.id) ?? null,
        lastFailure: failures.get(task.id) ?? null,
      })),
    })

    const report = {
      ...buildDigest({
        workspaceId,
        now,
        windowStart,
        policyVersion: hashPolicy(policy),
        tasks,
        autoDecisions,
        retryAudits,
        completedAtByTask,
      }),
      attention,
    }
    const notice = Notice.parse({
      id: deps.newId(),
      workspaceId,
      ts: now,
      kind: 'digest',
      payload: report,
      readAt: null,
    })

    const event = deps.db.transaction((tx) => {
      insertNotice(tx, {
        id: notice.id,
        workspaceId,
        ts: notice.ts,
        kind: notice.kind,
        payload: notice.payload,
      })
      if (options.advanceWindow ?? trigger !== 'attention') {
        setSetting(tx, lastDigestKey(workspaceId), { at: now }, now)
      }
      insertAudit(tx, {
        id: deps.newId(),
        ts: now,
        actor: 'system',
        action: 'automation.digest.generate',
        detail: { workspaceId, trigger },
      })
      return deps.eventStore.appendWs(tx, { type: 'notice', payload: notice, ts: now })
    })
    deps.broadcast(event)
    return notice
  }

  return { generate }
}
