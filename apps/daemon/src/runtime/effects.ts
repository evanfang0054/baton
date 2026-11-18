import { attentionFor, type TaskEffect } from '@baton/core'
import type {
  Policy,
  Task,
  TaskStatus,
  TaskStatusCause,
  WorkspaceTrustSnapshot,
} from '@baton/protocol'
import {
  type ApprovalRecord,
  appendTaskFeedback,
  appendTaskPromptBlock,
  getActiveSession,
  insertAudit,
  insertReview,
  insertSession,
  updateApprovalDecision,
  updateReviewVerdict,
  updateSessionStatus,
} from '../db/repositories.js'
import type { BroadcastEvent, EventStore } from '../db/event-store.js'
import type { Tx } from '../db/types.js'
import type { RuntimeHooks } from './types.js'

const MAX_FEEDBACK_CHARS = 16_384

function enrichCause(
  tx: Tx,
  ctx: EffectContext,
  cause: TaskStatusCause | undefined,
): TaskStatusCause | undefined {
  if (!cause) return undefined
  const enriched = { ...cause }
  if (!enriched.sessionId) {
    if (enriched.approvalId && ctx.approval) {
      enriched.sessionId = ctx.approval.sessionId
    } else {
      const active = getActiveSession(tx, ctx.task.id)
      if (active) enriched.sessionId = active.id
    }
  }
  return enriched
}

export interface EffectContext {
  eventStore: EventStore
  hooks: RuntimeHooks
  task: Task
  previousStatus: TaskStatus
  retryCount: number
  now: number
  newId: () => string
  workspacePath: string
  policy: Policy
  workspaceTrust: WorkspaceTrustSnapshot
  bypassPermissions: boolean
  approval: ApprovalRecord | null
  verifyMeta: Map<string, number>
}

export interface EffectPlan {
  events: BroadcastEvent[]
  afterCommit: Array<() => void | Promise<void>>
  sessionId?: string
}

function assertNever(value: never): never {
  throw new Error(`unhandled effect: ${String(value)}`)
}

/**
 * 在调用方的事务里执行 DB 部分，收集待广播事件与提交后动作。
 * task.status 事件必须由 emitTaskStatus 产生，且它是 effects 的最后一项。
 */
export function planAndApplyEffects(tx: Tx, ctx: EffectContext, effects: TaskEffect[]): EffectPlan {
  const plan: EffectPlan = { events: [], afterCommit: [] }

  for (const effect of effects) {
    switch (effect.type) {
      case 'requestApproval': {
        if (!ctx.approval) {
          throw new Error('approval row missing for requestApproval')
        }
        updateSessionStatus(tx, ctx.approval.sessionId, 'waiting_input')
        plan.events.push(
          ctx.eventStore.appendApprovalRequest(tx, {
            approvalId: effect.approvalId,
            sessionId: ctx.approval.sessionId,
            request: ctx.approval.request,
            ts: ctx.now,
          }),
        )
        break
      }
      case 'resolveApproval': {
        if (!ctx.approval) {
          throw new Error('approval row missing for resolveApproval')
        }
        updateApprovalDecision(tx, effect.approvalId, effect.decision, 'user', ctx.now)
        updateSessionStatus(tx, ctx.approval.sessionId, 'running')
        plan.afterCommit.push(() =>
          ctx.hooks.resolveApproval(effect.approvalId, effect.decision, effect.note),
        )
        break
      }
      case 'runVerify': {
        plan.afterCommit.push(() => ctx.hooks.runVerify(ctx.task.id))
        break
      }
      case 'persistVerifyResult': {
        insertReview(tx, {
          id: effect.reviewId,
          taskId: ctx.task.id,
          verdict: null,
          verifyExitCode: effect.exitCode,
          verifyOutput: effect.output,
          diffStat: effect.diffStat,
          decidedAt: null,
        })
        const durationMs = ctx.verifyMeta.get(effect.reviewId) ?? 0
        ctx.verifyMeta.delete(effect.reviewId)
        plan.events.push(
          ctx.eventStore.appendVerifyResult(tx, {
            taskId: ctx.task.id,
            reviewId: effect.reviewId,
            exitCode: effect.exitCode,
            output: effect.output,
            diffStat: effect.diffStat,
            durationMs,
            ts: ctx.now,
          }),
        )
        break
      }
      case 'persistReviewVerdict': {
        updateReviewVerdict(tx, effect.reviewId, effect.verdict, ctx.now)
        break
      }
      case 'appendFeedback': {
        appendTaskFeedback(tx, ctx.task.id, effect.feedback, MAX_FEEDBACK_CHARS, ctx.now)
        break
      }
      case 'appendUserReply': {
        appendTaskPromptBlock(
          tx,
          ctx.task.id,
          'user_reply',
          effect.text,
          MAX_FEEDBACK_CHARS,
          ctx.now,
        )
        break
      }
      case 'incrementRetry': {
        insertAudit(tx, {
          id: ctx.newId(),
          ts: ctx.now,
          actor: 'system',
          action: 'task.retry',
          detail: { taskId: ctx.task.id, retryCount: ctx.retryCount },
        })
        break
      }
      case 'startSession': {
        const sessionId = ctx.newId()
        insertSession(tx, {
          id: sessionId,
          taskId: ctx.task.id,
          adapter: ctx.task.engine,
          engineSessionId: null,
          status: 'running',
          outcome: null,
          startedAt: ctx.now,
          endedAt: null,
        })
        plan.sessionId = sessionId
        plan.afterCommit.push(() =>
          ctx.hooks.startSession({
            taskId: ctx.task.id,
            sessionId,
            workspacePath: ctx.workspacePath,
            policy: ctx.policy,
            workspaceTrust: ctx.workspaceTrust,
            bypassPermissions: ctx.bypassPermissions,
          }),
        )
        break
      }
      case 'interruptSession': {
        const active = getActiveSession(tx, ctx.task.id)
        if (active) {
          updateSessionStatus(tx, active.id, 'ended', ctx.now)
        }
        plan.afterCommit.push(() => ctx.hooks.interruptSession(ctx.task.id))
        break
      }
      case 'enqueueTask': {
        plan.afterCommit.push(() => ctx.hooks.kick())
        break
      }
      case 'emitTaskStatus': {
        const cause = enrichCause(tx, ctx, effect.cause)
        plan.events.push(
          ctx.eventStore.appendTaskStatus(tx, {
            taskId: ctx.task.id,
            status: effect.status,
            previousStatus: ctx.previousStatus,
            retryCount: ctx.retryCount,
            updatedAt: ctx.now,
            ...(cause ? { cause } : {}),
            attention: attentionFor(effect.status, cause?.waitingReason ?? null),
          }),
        )
        break
      }
      case 'sendToSession': {
        plan.afterCommit.push(() => ctx.hooks.sendToSession(ctx.task.id, effect.text))
        break
      }
      default:
        assertNever(effect)
    }
  }

  return plan
}
