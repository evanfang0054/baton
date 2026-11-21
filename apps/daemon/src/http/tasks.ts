import { attentionFor, waitingSinceFor } from '@baton/core'
import {
  TaskAutomationSummary,
  TaskDetailResponse,
  TaskHistoryQuery,
  TaskHistoryResponse,
  TaskListQuery,
  TaskListResponse,
} from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import { getAcceptanceResponse } from '../acceptance/report-service.js'
import { getTaskBudgetSummary } from '../budget/service.js'
import type { Config } from '../config.js'
import { listAcceptanceSummaries } from '../db/acceptance-repository.js'
import {
  getReviewByTask,
  getTask,
  getTaskDetail,
  getWorkspace,
  hasOtherWorktreeReference,
  hasReviewDiff,
  insertAudit,
  listApprovalsByTask,
  listAudit,
  listReviewsByTask,
  listSessionsByTask,
  listTaskStatusHistory,
  listTasks,
  updateTaskWorktreePath,
  type ApprovalRecord,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import type { Logger } from '../log.js'
import { resolveWorkspaceDir } from '../workspace/resolver.js'
import { isInsideDataDir, removeWorktree } from '../workspace/worktree.js'

export interface TaskRoutesDeps {
  db: Db
  config: Config
  logger: Logger
  now: () => number
  newId: () => string
}

export function registerTaskRoutes(app: FastifyInstance, deps: TaskRoutesDeps): void {
  app.get('/api/tasks', async (req) => {
    const parsed = TaskListQuery.safeParse(req.query)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid task query', parsed.error.issues)
    }
    const rows = listTasks(deps.db, parsed.data)
    const acceptance = listAcceptanceSummaries(
      deps.db,
      rows.map((task) => task.id),
    )
    const tasks = rows.map((task) => ({
      ...task,
      attention: attentionFor(task.status, task.waitingReason),
      waitingSince: waitingSinceFor(task),
      acceptance: acceptance.get(task.id) ?? null,
      budget: getTaskBudgetSummary(deps.db, task, deps.config),
    }))
    return TaskListResponse.parse({ tasks })
  })

  app.get('/api/tasks/:id/acceptance', async (req) => {
    const params = req.params as { id?: string }
    if (!params.id) {
      throw appError('invalid_payload', 'task id is required')
    }
    const task = getTask(deps.db, params.id)
    if (!task) {
      throw appError('task_not_found', 'task not found', { taskId: params.id })
    }
    const response = getAcceptanceResponse(deps.db, task, deps.config)
    if (!response) {
      throw appError('acceptance_not_found', 'acceptance not found', { taskId: params.id })
    }
    return response
  })

  app.get('/api/tasks/:id', async (req) => {
    const params = req.params as { id?: string }
    if (!params.id) {
      throw appError('invalid_payload', 'task id is required')
    }
    const detail = getTaskDetail(deps.db, params.id)
    if (!detail) {
      throw appError('task_not_found', 'task not found', { taskId: params.id })
    }
    if (detail.contextInvalid) {
      deps.logger.warn(
        { event: 'context_snapshot_invalid', taskId: params.id },
        'context snapshot invalid',
      )
    }
    if (detail.originInvalid) {
      deps.logger.warn({ event: 'task_origin_invalid', taskId: params.id }, 'task origin invalid')
    }
    const task = detail.task
    const review = getReviewByTask(deps.db, task.id)
    const acceptance = listAcceptanceSummaries(deps.db, [task.id]).get(task.id) ?? null
    return TaskDetailResponse.parse({
      task,
      contextInvalid: detail.contextInvalid,
      originInvalid: detail.originInvalid,
      sessions: listSessionsByTask(deps.db, task.id),
      approvals: listApprovalsByTask(deps.db, task.id),
      review: review ? { ...review, diffAvailable: hasReviewDiff(deps.db, review.id) } : null,
      waitingSince: waitingSinceFor(task),
      attention: attentionFor(task.status, task.waitingReason),
      acceptance,
      budget: getTaskBudgetSummary(deps.db, task, deps.config),
    })
  })

  app.get('/api/tasks/:id/history', async (req) => {
    const parsed = TaskHistoryQuery.safeParse(req.query)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid history query', parsed.error.issues)
    }
    const { id } = req.params as { id?: string }
    if (!id) throw appError('invalid_payload', 'task id is required')
    const detail = getTaskDetail(deps.db, id)
    if (!detail) throw appError('task_not_found', 'task not found', { taskId: id })

    const { items, nextBeforeOrdinal } = listTaskStatusHistory(
      deps.db,
      id,
      parsed.data.limit,
      parsed.data.beforeOrdinal,
    )
    return TaskHistoryResponse.parse({
      taskId: id,
      statusEvents: items,
      sessions: listSessionsByTask(deps.db, id),
      reviews: listReviewsByTask(deps.db, id),
      ...(nextBeforeOrdinal !== undefined ? { nextBeforeOrdinal } : {}),
    })
  })

  app.get('/api/tasks/:id/automation', async (req) => {
    const { id } = req.params as { id?: string }
    if (!id) throw appError('invalid_payload', 'task id is required')
    const detail = getTaskDetail(deps.db, id)
    if (!detail) throw appError('task_not_found', 'task not found', { taskId: id })

    const approvals = listApprovalsByTask(deps.db, id)
    type AutoApproval = ApprovalRecord & { decidedAt: number; decision: 'allow' | 'deny' }
    const autoApprovals = approvals.filter(
      (item): item is AutoApproval =>
        item.decidedBy === 'auto' && item.decidedAt !== null && item.decision !== null,
    )
    const autoAudits = listAudit(deps.db, { actionPrefix: 'approval.auto_', limit: 100 })
    const policyByApproval = new Map(
      autoAudits.map((entry) => {
        const data = entry.detail as { approvalId?: string; policyVersion?: string }
        return [data.approvalId ?? '', data.policyVersion ?? null] as const
      }),
    )
    const retryAudits = listAudit(deps.db, { actionPrefix: 'task.retry', limit: 100 }).filter(
      (entry) => (entry.detail as { taskId?: string }).taskId === id,
    )
    const latestRetry = retryAudits[0]?.detail as { policyVersion?: string } | undefined
    const review = getReviewByTask(deps.db, id)

    return TaskAutomationSummary.parse({
      taskId: id,
      retryCount: detail.task.retryCount,
      lastVerifyExitCode: review?.verifyExitCode ?? null,
      lastPolicyVersion: latestRetry?.policyVersion ?? null,
      autoDecisions: autoApprovals.map((item) => ({
        approvalId: item.id,
        decision: item.decision,
        toolName: item.request.toolName,
        risk: item.request.risk,
        decidedAt: item.decidedAt,
        policyVersion: policyByApproval.get(item.id) ?? null,
      })),
    })
  })

  app.post('/api/tasks/:id/worktree/cleanup', async (req) => {
    const { id } = req.params as { id?: string }
    if (!id) throw appError('invalid_payload', 'task id is required')
    const task = getTask(deps.db, id)
    if (!task) throw appError('task_not_found', 'task not found', { taskId: id })
    // todo/queued 仍可能被批量开工或 scheduler 拉起；清理必须避开这些会复用工作树的状态。
    if (!['review', 'done', 'cancelled', 'failed'].includes(task.status)) {
      throw appError('task_active', 'cannot clean a task that may still run', { taskId: id })
    }
    if (!task.worktreePath) {
      throw appError('worktree_not_found', 'task has no worktree', { taskId: id })
    }
    if (!isInsideDataDir(deps.config.dataDir, task.worktreePath)) {
      throw appError('invalid_path', 'worktree path escapes data dir', { taskId: id })
    }
    if (hasOtherWorktreeReference(deps.db, task.worktreePath, task.id)) {
      throw appError('worktree_shared', 'worktree is shared with another task', { taskId: id })
    }
    const workspace = getWorkspace(deps.db, task.workspaceId)
    if (!workspace) {
      throw appError('workspace_not_found', 'workspace not found', {
        workspaceId: task.workspaceId,
      })
    }
    const workspacePath = resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
    const removed = await removeWorktree({ workspacePath, path: task.worktreePath })
    if (!removed.ok) {
      throw appError('worktree_remove_failed', removed.reason ?? 'worktree remove failed', {
        taskId: id,
      })
    }
    const now = deps.now()
    deps.db.transaction((tx) => {
      updateTaskWorktreePath(tx, task.id, null, now)
      insertAudit(tx, {
        id: deps.newId(),
        ts: now,
        actor: 'user',
        action: 'worktree.cleanup',
        detail: {
          taskId: task.id,
          workspaceId: task.workspaceId,
          branch: `baton/${task.id}`,
        },
      })
    })
    return { ok: true }
  })
}
