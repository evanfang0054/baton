import { canAcceptUserInput } from '@baton/core'
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
import { appError, toAppError } from '../errors.js'
import type { Logger } from '../log.js'
import { createVerifyRunner, type VerifyRunner } from '../verify/runner.js'
import type { AdapterFactory } from './adapter-factory.js'
import { createScheduler, type Scheduler } from './scheduler.js'
import { createSessionRunner, type SessionRunner } from './session-runner.js'
import { createTaskService } from './task-service.js'
import { createTransitionRunner } from './transition-runner.js'
import type { RuntimeHooks, StartSessionInput, TransitionOutcome } from './types.js'

export interface RuntimeDeps {
  db: Db
  config: Config
  broadcast: (event: BroadcastEvent) => void
  adapters?: AdapterFactory
  startSession?: (input: StartSessionInput) => void | Promise<void>
  interruptSession?: (taskId: string) => void | Promise<void>
  resolveApproval?: (
    approvalId: string,
    decision: 'allow' | 'deny',
    note?: string,
  ) => void | Promise<void>
  runVerify?: (taskId: string) => void | Promise<void>
  sendToSession?: (taskId: string, text: string) => void | Promise<void>
  now?: () => number
  newId?: () => string
  logger?: Logger
}

export type CommandOutcome =
  { ok: true; ack: Record<string, unknown>; replay?: WsEventRow[] } | { ok: false; error: AppError }

function ackFromOutcome(outcome: TransitionOutcome): CommandOutcome {
  if (!outcome.ok) {
    return { ok: false, error: outcome.error }
  }
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
  const sessionHolder: { value?: SessionRunner } = {}
  const verifyHolder: { value?: VerifyRunner } = {}
  let closing = false
  let booting = false

  const hooks: RuntimeHooks = {
    broadcast: deps.broadcast,
    startSession:
      deps.startSession ??
      ((input) => {
        if (closing) {
          return
        }
        return sessionHolder.value ? sessionHolder.value.start(input) : undefined
      }),
    interruptSession:
      deps.interruptSession ??
      ((taskId) => (sessionHolder.value ? sessionHolder.value.interrupt(taskId) : undefined)),
    resolveApproval:
      deps.resolveApproval ??
      ((approvalId, decision, note) =>
        sessionHolder.value ? sessionHolder.value.approve(approvalId, decision, note) : undefined),
    runVerify: deps.runVerify ?? ((taskId) => verifyHolder.value?.run(taskId) ?? Promise.resolve()),
    sendToSession:
      deps.sendToSession ??
      ((taskId, text) =>
        sessionHolder.value ? sessionHolder.value.reply(taskId, text) : undefined),
    kick: () => {
      if (closing || booting) {
        return
      }
      schedulerHolder.value?.kick()
    },
    track: (action) => {
      const promise = Promise.resolve()
        .then(action)
        .catch((error: unknown) => {
          // 异步动作失败由各 runner 自己收敛任务状态；这里保留错误码用于排障。
          const failure = toAppError(error)
          deps.logger?.error(
            { action: 'runtime', code: failure.code, message: failure.message },
            'runtime action failed',
          )
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

  if (!deps.runVerify) {
    verifyHolder.value = createVerifyRunner({
      db: deps.db,
      config: deps.config,
      applyTransition,
      now,
      newId,
      verifyMeta,
    })
  }

  function enqueue(taskId: string): TransitionOutcome {
    return applyTransition(taskId, { type: 'enqueue' })
  }

  function cancel(taskId: string, reason?: string): TransitionOutcome {
    const outcome = applyTransition(taskId, {
      type: 'cancel',
      ...(reason ? { reason } : {}),
    })
    if (outcome.ok && outcome.previousStatus === 'verifying') {
      verifyHolder.value?.cancel(taskId)
    }
    return outcome
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
        error: appError('already_decided', 'approval already decided', {
          kind: 'approval',
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
        error: appError('already_decided', 'review already decided', {
          kind: 'review',
          reviewId: input.reviewId,
        }),
      }
    }
    const current = getReviewByTask(deps.db, review.taskId)
    if (!current || current.id !== review.id) {
      return {
        ok: false,
        error: appError('review_expired', 'review is superseded by a newer attempt', {
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
      case 'session.reply': {
        const task = getTask(deps.db, message.payload.taskId)
        if (!task) {
          return {
            ok: false,
            error: appError('task_not_found', 'task not found', {
              taskId: message.payload.taskId,
            }),
          }
        }
        if (task.status !== 'waiting_input') {
          return {
            ok: false,
            error: appError('reply_not_allowed', 'task is not waiting for input', {
              taskId: task.id,
              status: task.status,
            }),
          }
        }
        if (!canAcceptUserInput(task.waitingReason)) {
          return {
            ok: false,
            error: appError('reply_not_allowed', 'approval must be decided with approval.decide', {
              taskId: task.id,
              waitingReason: task.waitingReason,
            }),
          }
        }
        if (!sessionHolder.value?.has(task.id)) {
          return {
            ok: false,
            error: appError('session_not_active', 'no active session for task', {
              taskId: task.id,
            }),
          }
        }
        return ackFromOutcome(
          applyTransition(task.id, { type: 'user_input', text: message.payload.text }),
        )
      }
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

  function findNextQueued(exclude?: ReadonlySet<string>): { id: string } | null {
    const next = listTasksByStatus(deps.db, ['queued']).find((task) => !exclude?.has(task.id))
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
    beginBoot: () => {
      booting = true
    },
    start: () => {
      if (closing) {
        return
      }
      booting = false
      schedulerHolder.value?.kick()
    },
    close: async () => {
      if (closing) {
        return
      }
      closing = true
      await verifyHolder.value?.close()
      await sessionHolder.value?.close()
      await settle()
    },
    getTask: (id: string) => getTask(deps.db, id),
    getReviewByTask: (taskId: string) => getReviewByTask(deps.db, taskId),
    getSession: (id: string) => getSession(deps.db, id),
    countActiveTasks: () => countActiveTasks(deps.db),
    findNextQueued,
    maxConcurrency: deps.config.maxConcurrency,
  }

  const created = createScheduler(runtime)
  schedulerHolder.value = created

  if (deps.adapters) {
    sessionHolder.value = createSessionRunner({
      db: deps.db,
      adapters: deps.adapters,
      eventStore,
      broadcast: deps.broadcast,
      applyTransition,
      now,
      newId,
      killSwitch: deps.config.killSwitch,
    })
  }

  return { ...runtime, scheduler: created }
}

export type Runtime = ReturnType<typeof createRuntime>
