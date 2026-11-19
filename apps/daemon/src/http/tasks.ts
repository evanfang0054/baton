import { attentionFor, waitingSinceFor } from '@baton/core'
import {
  TaskAutomationSummary,
  TaskDetailResponse,
  TaskListQuery,
  TaskListResponse,
} from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import {
  getReviewByTask,
  getReviewDiff,
  getTaskDetail,
  listApprovalsByTask,
  listAudit,
  listSessionsByTask,
  listTasks,
  type ApprovalRecord,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import type { Logger } from '../log.js'

export function registerTaskRoutes(app: FastifyInstance, deps: { db: Db; logger: Logger }): void {
  app.get('/api/tasks', async (req) => {
    const parsed = TaskListQuery.safeParse(req.query)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid task query', parsed.error.issues)
    }
    const tasks = listTasks(deps.db, parsed.data).map((task) => ({
      ...task,
      attention: attentionFor(task.status, task.waitingReason),
      waitingSince: waitingSinceFor(task),
    }))
    return TaskListResponse.parse({ tasks })
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
    return TaskDetailResponse.parse({
      task,
      contextInvalid: detail.contextInvalid,
      originInvalid: detail.originInvalid,
      sessions: listSessionsByTask(deps.db, task.id),
      approvals: listApprovalsByTask(deps.db, task.id),
      review: review
        ? { ...review, diffAvailable: Boolean(getReviewDiff(deps.db, review.id)) }
        : null,
      waitingSince: waitingSinceFor(task),
      attention: attentionFor(task.status, task.waitingReason),
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
}
