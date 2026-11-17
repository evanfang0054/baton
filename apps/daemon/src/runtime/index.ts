import type {
  AppError,
  ApprovalDecideInput,
  ClientMessage,
  ReviewDecideInput,
  TaskTransitionEvent,
} from '@baton/protocol'
import { randomUUID } from 'node:crypto'
import type { Config } from '../config.js'
import { createEventStore, type BroadcastEvent, type WsEventRow } from '../db/event-store.js'
import {
  countActiveTasks,
  getApproval,
  getReview,
  getReviewByTask,
  getSession,
  getTask,
  listTasksByStatus,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import { createScheduler, type Scheduler } from './scheduler.js'
import { createTaskService } from './task-service.js'
import { createTransitionRunner } from './transition-runner.js'
import type { RuntimeHooks, StartSessionInput, TransitionOutcome } from './types.js'

export interface RuntimeDeps {
  db: Db
  config: Config
  broadcast: (event: BroadcastEvent) => void
  startSession: (input: StartSessionInput) => void | Promise<void>
  interruptSession: (taskId: string) => void | Promise<void>
  resolveApproval: (
    approvalId: string,
    decision: 'allow' | 'deny',
    note?: string,
  ) => void | Promise<void>
  runVerify: (taskId: string) => void | Promise<void>
  now?: () => number
  newId?: () => string
}

export type CommandOutcome =
  { ok: true; ack: Record<string, unknown>; replay?: WsEventRow[] } | { ok: false; error: AppError }

function ackFromOutcome(outcome: TransitionOutcome): CommandOutcome {
  if (!outcome.ok) return { ok: false, error: outcome.error }
  return {
    ok: true,
    ack: {
      taskId: outcome.taskId,
      status: outcome.status,
      retryCount: outcome.retryCount,
    },
  }
}

export function createRuntime(deps: RuntimeDeps) {
  const now = deps.now ?? (() => Date.now())
  const newId = deps.newId ?? (() => randomUUID())
  const eventStore = createEventStore(deps.db, { now, newId })
  const verifyMeta = new Map<string, number>()
  const pending = new Set<Promise<void>>()
  const schedulerHolder: { value?: Scheduler } = {}

  const hooks: RuntimeHooks = {
    broadcast: deps.broadcast,
    startSession: deps.startSession,
    interruptSession: deps.interruptSession,
    resolveApproval: deps.resolveApproval,
    runVerify: deps.runVerify,
    kick: () => schedulerHolder.value?.kick(),
    track: (action) => {
      const promise = Promise.resolve()
        .then(action)
        .catch(() => {
          // 异步动作失败由各 runner 自己收敛任务状态；这里只保证 settle 不被卡住。
        })
        .finally(() => pending.delete(promise))
      pending.add(promise)
    },
  }

  const taskService = createTaskService({ db: deps.db, config: deps.config, now, newId })
  const transitionRunner = createTransitionRunner({
    db: deps.db,
    config: deps.config,
    eventStore,
    hooks,
    now,
    newId,
    verifyMeta,
  })

  function applyTransition(taskId: string, event: TaskTransitionEvent): TransitionOutcome {
    return transitionRunner.applyTransition(taskId, event)
  }

  function enqueue(taskId: string): TransitionOutcome {
    return applyTransition(taskId, { type: 'enqueue' })
  }

  function cancel(taskId: string, reason?: string): TransitionOutcome {
    return applyTransition(taskId, { type: 'cancel', ...(reason ? { reason } : {}) })
  }

  function decideApproval(input: ApprovalDecideInput): TransitionOutcome {
    const approval = getApproval(deps.db, input.approvalId)
    if (!approval) {
      return {
        ok: false,
        error: appError('approval_not_found', 'approval not found', {
          approvalId: input.approvalId,
        }),
      }
    }
    if (approval.decision !== null) {
      return {
        ok: false,
        error: appError('approval_expired', 'approval already decided', {
          approvalId: input.approvalId,
        }),
      }
    }
    const session = getSession(deps.db, approval.sessionId)
    if (!session) {
      return {
        ok: false,
        error: appError('session_not_found', 'session not found', {
          sessionId: approval.sessionId,
        }),
      }
    }
    const event: TaskTransitionEvent =
      input.decision === 'allow'
        ? {
            type: 'approval_allow',
            approvalId: input.approvalId,
            ...(input.note ? { note: input.note } : {}),
          }
        : {
            type: 'approval_deny',
            approvalId: input.approvalId,
            ...(input.note ? { note: input.note } : {}),
          }
    return applyTransition(session.taskId, event)
  }

  function decideReview(input: ReviewDecideInput): TransitionOutcome {
    const review = getReview(deps.db, input.reviewId)
    if (!review) {
      return {
        ok: false,
        error: appError('review_not_found', 'review not found', { reviewId: input.reviewId }),
      }
    }
    if (review.verdict !== null) {
      return {
        ok: false,
        error: appError('review_already_decided', 'review already decided', {
          reviewId: input.reviewId,
        }),
      }
    }
    if (input.decision === 'approve') {
      return applyTransition(review.taskId, { type: 'approve', reviewId: input.reviewId })
    }
    return applyTransition(review.taskId, {
      type: 'reject',
      reviewId: input.reviewId,
      feedback: input.feedback,
    })
  }

  function replay(sinceSeq?: number) {
    return eventStore.replay(sinceSeq ?? 0)
  }

  function handleCommand(message: ClientMessage): CommandOutcome {
    switch (message.type) {
      case 'task.create': {
        const result = taskService.createTask(message.payload)
        return result.ok
          ? { ok: true, ack: { taskId: result.taskId } }
          : { ok: false, error: result.error }
      }
      case 'task.enqueue':
        return ackFromOutcome(enqueue(message.payload.taskId))
      case 'task.cancel':
        return ackFromOutcome(cancel(message.payload.taskId, message.payload.reason))
      case 'approval.decide':
        return ackFromOutcome(decideApproval(message.payload))
      case 'review.decide':
        return ackFromOutcome(decideReview(message.payload))
      case 'resume': {
        const result = replay(message.payload.sinceSeq)
        const cursor = result.rows.at(-1)?.ordinal ?? eventStore.maxOrdinal()
        return {
          ok: true,
          ack: { cursor, hasMore: result.hasMore },
          replay: result.rows,
        }
      }
    }
  }

  function findNextQueued(): { id: string } | null {
    const next = listTasksByStatus(deps.db, ['queued'])[0]
    return next ? { id: next.id } : null
  }

  async function settle(): Promise<void> {
    while (pending.size > 0) {
      await Promise.all([...pending])
    }
  }

  const runtime = {
    createTask: taskService.createTask,
    applyTransition,
    enqueue,
    cancel,
    decideApproval,
    decideReview,
    handleCommand,
    replay,
    maxOrdinal: eventStore.maxOrdinal,
    settle,
    start: () => schedulerHolder.value?.kick(),
    close: settle,
    getTask: (id: string) => getTask(deps.db, id),
    getReviewByTask: (taskId: string) => getReviewByTask(deps.db, taskId),
    getSession: (id: string) => getSession(deps.db, id),
    countActiveTasks: () => countActiveTasks(deps.db),
    findNextQueued,
    maxConcurrency: deps.config.maxConcurrency,
  }

  const created = createScheduler(runtime)
  schedulerHolder.value = created
  return { ...runtime, scheduler: created }
}

export type Runtime = ReturnType<typeof createRuntime>
