import type { TaskStatus, TaskTransitionEvent } from '@baton/protocol'
import { effects } from './effects.js'
import type { TaskEffect, TransitionContext, TransitionResult } from './types.js'

const TERMINAL = new Set<TaskStatus>(['done', 'failed', 'cancelled'])
const ACTIVE_SESSION = new Set<TaskStatus>(['running', 'waiting_input', 'verifying'])

function ok(status: TaskStatus, retryCount: number, extra: TaskEffect[]): TransitionResult {
  return { ok: true, status, retryCount, effects: [effects.emitTaskStatus(status), ...extra] }
}

function invalid(ctx: TransitionContext, event: TaskTransitionEvent): TransitionResult {
  return {
    ok: false,
    error: {
      code: 'invalid_transition',
      message: `cannot apply ${event.type} from ${ctx.status}`,
      details: { from: ctx.status, event: event.type },
    },
  }
}

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
        return ok('waiting_input', ctx.retryCount, [effects.requestApproval(event.approvalId)])
      }
      if (event.type === 'completed') return ok('verifying', ctx.retryCount, [effects.runVerify()])
      if (event.type === 'error') {
        return ok('failed', ctx.retryCount, [effects.interruptSession(event.message)])
      }
      return invalid(ctx, event)

    case 'waiting_input':
      if (event.type === 'approval_allow') {
        return ok('running', ctx.retryCount, [effects.resolveApproval(event.approvalId, 'allow')])
      }
      if (event.type === 'approval_deny') {
        return ok('running', ctx.retryCount, [
          effects.resolveApproval(event.approvalId, 'deny', event.note),
        ])
      }
      if (event.type === 'error') {
        return ok('failed', ctx.retryCount, [effects.interruptSession(event.message)])
      }
      return invalid(ctx, event)

    case 'verifying':
    case 'review':
    case 'done':
    case 'failed':
    case 'cancelled':
      return invalid(ctx, event)
  }
}
