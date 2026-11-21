import type {
  TaskStatus,
  TaskStatusCause,
  TaskTransitionEvent,
  WaitingReason,
} from '@baton/protocol'
import { effects } from './effects.js'
import { canAcceptUserInput } from './attention.js'
import { canAutopilot } from '../automation/effective.js'
import type { TaskEffect, TransitionContext, TransitionResult } from './types.js'

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['done', 'failed', 'cancelled'])
// verifying 是 verify 子进程阶段，agent session 已结束；取消 verify 由 M1-5 的 verify executor 处理。
const ACTIVE_SESSION: ReadonlySet<TaskStatus> = new Set(['running', 'waiting_input'])

function ok(
  status: TaskStatus,
  retryCount: number,
  extra: TaskEffect[],
  waitingReason: WaitingReason | null = null,
  cause?: TaskStatusCause,
): TransitionResult {
  return {
    ok: true,
    status,
    retryCount,
    waitingReason,
    effects: [...extra, effects.emitTaskStatus(status, cause)],
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled task status: ${String(value)}`)
}

function invalid(ctx: TransitionContext, event: TaskTransitionEvent): TransitionResult {
  return {
    ok: false,
    error: {
      code: 'invalid_transition',
      message: `cannot apply ${event.type} from ${ctx.status}`,
      details: {
        from: ctx.status,
        event: event.type,
        ...(event.type === 'user_input' ? { waitingReason: ctx.waitingReason } : {}),
      },
    },
  }
}

/**
 * 纯状态转移：不读写 IO，不修改入参；成功时 effects 以 emitTaskStatus 结尾。
 * 调用方必须传入经 zod 校验的 TaskStatus / TaskTransitionEvent；assertNever 只做类型穷尽兜底。
 */
export function transition(ctx: TransitionContext, event: TaskTransitionEvent): TransitionResult {
  if (event.type === 'cancel') {
    if (TERMINAL.has(ctx.status)) return invalid(ctx, event)
    const extra = ACTIVE_SESSION.has(ctx.status) ? [effects.interruptSession(event.reason)] : []
    return ok('cancelled', ctx.retryCount, extra)
  }

  switch (ctx.status) {
    case 'todo':
      if (event.type === 'enqueue') return ok('queued', ctx.retryCount, [effects.enqueueTask()])
      return invalid(ctx, event)

    case 'queued':
      if (event.type === 'start') {
        if (ctx.runningCount >= ctx.maxConcurrency) {
          return {
            ok: false,
            error: {
              code: 'guard_failed',
              message: 'max concurrency reached',
              details: {
                runningCount: ctx.runningCount,
                maxConcurrency: ctx.maxConcurrency,
              },
            },
          }
        }
        return ok('running', ctx.retryCount, [effects.startSession()])
      }
      return invalid(ctx, event)

    case 'running':
      if (event.type === 'approval_requested') {
        return ok(
          'waiting_input',
          ctx.retryCount,
          [effects.requestApproval(event.approvalId)],
          'approval',
          { waitingReason: 'approval', approvalId: event.approvalId },
        )
      }
      if (event.type === 'session_reported') {
        const waitingReason: WaitingReason =
          event.outcome === 'blocked'
            ? 'question'
            : event.outcome === 'dropped'
              ? 'dropped'
              : 'stalled'
        return ok('waiting_input', ctx.retryCount, [], waitingReason, {
          waitingReason,
          outcome: event.outcome,
          ...(event.reason ? { reason: event.reason } : {}),
        })
      }
      if (event.type === 'completed') return ok('verifying', ctx.retryCount, [effects.runVerify()])
      if (event.type === 'error') {
        return ok('failed', ctx.retryCount, [effects.interruptSession(event.message)], null, {
          reason: event.message,
        })
      }
      return invalid(ctx, event)

    case 'waiting_input':
      if (event.type === 'approval_allow') {
        return ok(
          'running',
          ctx.retryCount,
          [effects.resolveApproval(event.approvalId, 'allow')],
          null,
          { approvalId: event.approvalId },
        )
      }
      if (event.type === 'approval_deny') {
        return ok(
          'running',
          ctx.retryCount,
          [effects.resolveApproval(event.approvalId, 'deny', event.note)],
          null,
          { approvalId: event.approvalId },
        )
      }
      if (event.type === 'session_reported') {
        // 重启对账/重复上报：等待中的任务已经被看见，保持 waiting_input 只刷新原因。
        const waitingReason: WaitingReason =
          event.outcome === 'blocked'
            ? 'question'
            : event.outcome === 'dropped'
              ? 'dropped'
              : 'stalled'
        return ok('waiting_input', ctx.retryCount, [], waitingReason, {
          waitingReason,
          outcome: event.outcome,
          ...(event.reason ? { reason: event.reason } : {}),
        })
      }
      if (event.type === 'enqueue' && ctx.waitingReason === 'stalled') {
        return ok('queued', ctx.retryCount, [effects.enqueueTask()])
      }
      if (event.type === 'user_input') {
        if (!canAcceptUserInput(ctx.waitingReason)) {
          return invalid(ctx, event)
        }
        return ok('running', ctx.retryCount, [
          effects.sendToSession(event.text),
          effects.appendUserReply(event.text),
          ...(event.contextInjection
            ? [effects.appendContextInjection(event.contextInjection)]
            : []),
        ])
      }
      if (event.type === 'error') {
        return ok('failed', ctx.retryCount, [effects.interruptSession(event.message)], null, {
          reason: event.message,
        })
      }
      return invalid(ctx, event)

    case 'verifying': {
      if (event.type === 'verify_ok' && event.exitCode === 0) {
        return ok(
          'review',
          ctx.retryCount,
          [
            effects.persistVerifyResult(
              event.reviewId,
              event.exitCode,
              event.output,
              event.diffStat,
            ),
          ],
          null,
          { reviewId: event.reviewId },
        )
      }
      if (event.type === 'verify_fail') {
        const persisted = effects.persistVerifyResult(
          event.reviewId,
          event.exitCode,
          event.output,
          event.diffStat,
        )
        if (
          event.retryable !== false &&
          ctx.autopilot.enabled &&
          canAutopilot({
            workspaceTrusted: ctx.workspaceTrusted,
            killSwitch: ctx.killSwitch,
          }) &&
          ctx.retryCount < ctx.autopilot.retryMax
        ) {
          return ok(
            'queued',
            ctx.retryCount + 1,
            [
              persisted,
              effects.incrementRetry(),
              effects.appendFeedback(event.output),
              effects.enqueueTask(),
            ],
            null,
            { reviewId: event.reviewId },
          )
        }
        return ok('review', ctx.retryCount, [persisted], null, { reviewId: event.reviewId })
      }
      return invalid(ctx, event)
    }

    case 'review':
      if (event.type === 'approve') {
        return ok(
          'done',
          ctx.retryCount,
          [
            effects.persistReviewVerdict(event.reviewId, 'approved'),
            ...(event.override
              ? [
                  effects.auditReviewOverride(
                    event.reviewId,
                    event.override.verifyExitCode,
                    event.override.reasonProvided,
                  ),
                ]
              : []),
          ],
          null,
          { reviewId: event.reviewId },
        )
      }
      if (event.type === 'reject') {
        return ok(
          'queued',
          ctx.retryCount,
          [
            effects.persistReviewVerdict(event.reviewId, 'rejected'),
            effects.appendFeedback(event.feedback),
            ...(event.contextInjection
              ? [effects.appendContextInjection(event.contextInjection, event.contextBlock)]
              : []),
            effects.enqueueTask(),
          ],
          null,
          { reviewId: event.reviewId },
        )
      }
      return invalid(ctx, event)

    case 'failed':
      if (event.type === 'retry') {
        const extra: TaskEffect[] = event.note ? [effects.appendFeedback(event.note)] : []
        extra.push(effects.enqueueTask())
        return ok('queued', 0, extra)
      }
      return invalid(ctx, event)

    case 'done':
    case 'cancelled':
      if (event.type === 'reopen') {
        const extra = event.note ? [effects.appendReopenNote(event.note)] : []
        return ok('todo', 0, extra)
      }
      return invalid(ctx, event)

    default:
      return assertNever(ctx.status)
  }
}
