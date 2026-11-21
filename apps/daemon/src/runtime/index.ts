import { canAcceptUserInput } from '@baton/core'
import { Node } from '@baton/protocol'
import type {
  AppError,
  ApprovalDecideInput,
  ClientMessage,
  Engine,
  ReviewDecideInput,
  TaskTransitionEvent,
} from '@baton/protocol'
import { randomUUID } from 'node:crypto'
import { createDigestService } from '../automation/digest.js'
import { createDigestScheduler, createTimeoutSchedule } from '../automation/scheduler.js'
import { createAutomationService } from '../automation/service.js'
import { createAutomationState } from '../automation/state.js'
import type { Config } from '../config.js'
import { createEventStore, type BroadcastEvent, type WsEventRow } from '../db/event-store.js'
import {
  countActiveTasks,
  countLiveSessions,
  createGroup,
  deleteEdgesForNode,
  deleteNode,
  getApproval,
  getCanvas,
  getNode,
  getReview,
  getReviewByTask,
  getSession,
  getSetting,
  getTask,
  hasTaskForNode,
  insertNode,
  listTasksByStatus,
  listWorkspaces,
  moveNodes,
  ungroupChildren,
  updateApprovalResponse,
  updateNode,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError, isAppError, toAppError } from '../errors.js'
import type { Logger } from '../log.js'
import { createVerifyRunner, type VerifyRunner } from '../verify/runner.js'
import type { AdapterFactory } from './adapter-factory.js'
import { createEdge, deleteEdge } from './edge-service.js'
import { createHandoffNode } from '../handoff/service.js'
import type { EngineRegistry } from './engines.js'
import { createScheduler, type Scheduler } from './scheduler.js'
import { createSessionRunner, type SessionRunner } from './session-runner.js'
import { validateQuestionAnswers } from './questions.js'
import { createTaskService } from './task-service.js'
import { createTransitionRunner } from './transition-runner.js'
import { loadPolicy } from '../workspace/policy.js'
import { isValidImageSrc } from '../workspace/image-src.js'
import { resolveWorkspaceDir } from '../workspace/resolver.js'
import { createSupervisorService } from '../supervisor/service.js'
import type { SupervisorEngine } from '../supervisor/engine.js'
import type { RuntimeHooks, StartSessionInput, TransitionOutcome } from './types.js'

export interface RuntimeDeps {
  db: Db
  config: Config
  broadcast: (event: BroadcastEvent) => void
  adapters?: AdapterFactory
  engines?: EngineRegistry
  startSession?: (input: StartSessionInput) => void | Promise<void>
  interruptSession?: (taskId: string) => void | Promise<void>
  resolveApproval?: (
    approvalId: string,
    decision: 'allow' | 'deny',
    note?: string,
  ) => void | Promise<void>
  runVerify?: (taskId: string) => void | Promise<void>
  sendToSession?: (taskId: string, text: string) => void | Promise<void>
  broadcastRaw?: (frame: string) => void
  supervisorEngine?: SupervisorEngine
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
  const supervisorHolder: { value?: ReturnType<typeof createSupervisorService> } = {}
  const transitionRunnerHolder: { value?: ReturnType<typeof createTransitionRunner> } = {}
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
    observeTask: (input) => {
      try {
        supervisorHolder.value?.observeTask(input)
      } catch (error) {
        const failure = toAppError(error)
        deps.logger?.error(
          { event: 'supervisor.observe_failed', taskId: input.taskId, code: failure.code },
          'supervisor observation failed',
        )
      }
    },
    cancelVerifiers: (targetTaskId) => {
      try {
        supervisorHolder.value?.cancelVerifiersForTarget(targetTaskId)
      } catch (error) {
        const failure = toAppError(error)
        deps.logger?.error(
          { event: 'supervisor.cancel_verifiers_failed', taskId: targetTaskId, code: failure.code },
          'failed to cancel verifiers',
        )
      }
    },
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
  let persistedKillSwitch: boolean
  try {
    const setting = getSetting(deps.db, 'kill_switch') as { enabled?: boolean } | null
    persistedKillSwitch = setting?.enabled === true
  } catch {
    // 设置损坏时按强制暂停处理，避免安全开关 fail-open。
    persistedKillSwitch = true
  }
  const automationState = createAutomationState({
    initial: persistedKillSwitch,
    forced: deps.config.killSwitch,
  })
  let rescheduleDigest = (): void => {}
  const automation = createAutomationService({
    db: deps.db,
    config: deps.config,
    state: automationState,
    now,
    newId,
    ...(deps.logger ? { logger: deps.logger } : {}),
    onPolicyChanged: () => rescheduleDigest(),
  })
  const digest = createDigestService({
    db: deps.db,
    config: deps.config,
    eventStore,
    broadcast: deps.broadcast,
    now,
    newId,
  })
  const digestScheduler = createDigestScheduler({
    listWorkspaces: () =>
      listWorkspaces(deps.db).map((workspace) => {
        try {
          const path = resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
          return {
            id: workspace.id,
            trusted: workspace.trusted,
            digestCron: loadPolicy(path).autopilot.digestCron,
          }
        } catch {
          return { id: workspace.id, trusted: false, digestCron: '0 9,21 * * *' }
        }
      }),
    generate: (workspaceId) => Promise.resolve(digest.generate(workspaceId, 'schedule')),
    schedule: createTimeoutSchedule,
    ...(deps.logger ? { logger: deps.logger } : {}),
  })
  rescheduleDigest = () => digestScheduler.reschedule()
  const defaultEngine: Engine =
    deps.engines && deps.engines.get('claude-sdk').status === 'unavailable' ? 'fake' : 'claude-sdk'

  function replyToTask(taskId: string, text: string): CommandOutcome {
    const task = getTask(deps.db, taskId)
    if (!task) {
      return { ok: false, error: appError('task_not_found', 'task not found', { taskId }) }
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
        error: appError('session_not_active', 'no active session for task', { taskId: task.id }),
      }
    }
    return ackFromOutcome(applyTransition(task.id, { type: 'user_input', text }))
  }

  const supervisor = createSupervisorService({
    db: deps.db,
    eventStore,
    dataDir: deps.config.dataDir,
    taskService,
    defaultEngine,
    enqueueTask: (taskId) => {
      const outcome = enqueue(taskId)
      return outcome.ok ? { ok: true, status: outcome.status } : { ok: false, error: outcome.error }
    },
    applyTransition: (taskId, event) =>
      transitionRunnerHolder.value
        ? transitionRunnerHolder.value.applyTransition(taskId, event)
        : {
            ok: false,
            error: appError('runtime_not_ready', 'transition runner is not ready'),
          },
    replyToTask,
    cancelTask: cancel,
    workspacesRoot: deps.config.workspacesRoot,
    killSwitch: () => automationState.isKillSwitchOn(),
    ...(deps.supervisorEngine ? { engine: deps.supervisorEngine } : {}),
    now,
    newId,
    ...(deps.logger ? { logger: deps.logger } : {}),
    ...(deps.broadcastRaw ? { broadcastRaw: deps.broadcastRaw } : {}),
    track: hooks.track,
  })
  supervisorHolder.value = supervisor
  const transitionRunner = createTransitionRunner({
    db: deps.db,
    config: deps.config,
    eventStore,
    hooks,
    now,
    newId,
    verifyMeta,
    killSwitch: () => automationState.isKillSwitchOn(),
  })
  transitionRunnerHolder.value = transitionRunner

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
      ...(deps.logger ? { logger: deps.logger } : {}),
    })
  }

  function enqueue(taskId: string): TransitionOutcome {
    const task = getTask(deps.db, taskId)
    if (task && deps.engines) {
      const status = deps.engines.get(task.engine)
      if (status.status === 'unavailable') {
        return {
          ok: false,
          error: appError(
            'engine_unavailable',
            status.reason ?? `engine ${task.engine} is unavailable`,
            { engine: task.engine, status: status.status },
          ),
        }
      }
    }
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
    // 结构化提问必须在决定前拿到合法答案；答案与决定分开存，但同一次命令完成。
    const answerCheck = validateQuestionAnswers(approval.request, input)
    if (!answerCheck.ok) {
      return { ok: false, error: answerCheck.error }
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
    if (answerCheck.payload) {
      deps.db.transaction((tx) => updateApprovalResponse(tx, approval.id, answerCheck.payload))
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
      case 'task.retry':
        return ackFromOutcome(
          applyTransition(message.payload.taskId, {
            type: 'retry',
            ...(message.payload.note ? { note: message.payload.note } : {}),
          }),
        )
      case 'task.reopen':
        return ackFromOutcome(
          applyTransition(message.payload.taskId, {
            type: 'reopen',
            ...(message.payload.note ? { note: message.payload.note } : {}),
          }),
        )
      case 'task.handoff': {
        const result = createHandoffNode(
          {
            db: deps.db,
            workspacesRoot: deps.config.workspacesRoot,
            now,
            newId,
            ...(deps.logger ? { logger: deps.logger } : {}),
          },
          {
            taskId: message.payload.taskId,
            workspaceId: message.payload.workspaceId,
            actor: 'user',
          },
        )
        return result.ok
          ? {
              ok: true,
              ack: {
                taskId: message.payload.taskId,
                nodeId: result.node.id,
                warnings: result.summary.warnings,
              },
            }
          : { ok: false, error: result.error }
      }
      case 'session.reply':
        return replyToTask(message.payload.taskId, message.payload.text)
      case 'approval.decide':
        return ackFromOutcome(decideApproval(message.payload))
      case 'review.decide':
        return ackFromOutcome(decideReview(message.payload))
      case 'node.create': {
        const canvas = getCanvas(deps.db, message.payload.canvasId)
        if (!canvas) {
          return {
            ok: false,
            error: appError('canvas_not_found', 'canvas not found', {
              canvasId: message.payload.canvasId,
            }),
          }
        }
        const input = message.payload.node
        if (input.type === 'group' || input.type === 'review') {
          return {
            ok: false,
            error: appError(
              'unsupported_node_type',
              'node type must be created via its own command',
              {
                type: input.type,
              },
            ),
          }
        }
        if (input.type === 'image') {
          if (!isValidImageSrc(input.data.src)) {
            return { ok: false, error: appError('image_src_invalid', 'invalid image src') }
          }
          if (input.data.alt !== undefined && input.data.alt.length > 200) {
            return { ok: false, error: appError('invalid_payload', 'image alt is too long') }
          }
        }
        if (input.groupId !== null) {
          const group = getNode(deps.db, input.groupId)
          if (!group || group.type !== 'group' || group.canvasId !== canvas.id) {
            return { ok: false, error: appError('group_invalid', 'group not found in canvas') }
          }
        }
        const id = newId()
        const ts = now()
        let created: Node
        try {
          created = Node.parse({
            id,
            canvasId: canvas.id,
            ...input,
            createdAt: ts,
            updatedAt: ts,
          })
        } catch {
          return { ok: false, error: appError('invalid_payload', 'invalid node payload') }
        }
        deps.db.transaction((tx) => insertNode(tx, created))
        return { ok: true, ack: { nodeId: id } }
      }
      case 'node.update': {
        const existing = getNode(deps.db, message.payload.nodeId)
        if (!existing) {
          return {
            ok: false,
            error: appError('node_not_found', 'node not found', {
              nodeId: message.payload.nodeId,
            }),
          }
        }
        const patch = message.payload.patch
        if (patch.groupId !== undefined) {
          if (existing.type === 'group') {
            return {
              ok: false,
              error: appError('group_invalid', 'group node cannot be nested'),
            }
          }
          if (patch.groupId !== null) {
            const group = getNode(deps.db, patch.groupId)
            if (!group || group.type !== 'group' || group.canvasId !== existing.canvasId) {
              return { ok: false, error: appError('group_invalid', 'group not found in canvas') }
            }
          }
        }
        if (
          existing.type !== 'text' &&
          existing.type !== 'file' &&
          existing.type !== 'agent' &&
          existing.type !== 'image' &&
          existing.type !== 'group'
        ) {
          return {
            ok: false,
            error: appError('unsupported_node_type', 'node type is not supported', {
              type: existing.type,
            }),
          }
        }
        if (patch.data !== undefined) {
          if (typeof patch.data !== 'object' || patch.data === null || Array.isArray(patch.data)) {
            return { ok: false, error: appError('invalid_payload', 'node data must be an object') }
          }
          if (existing.type === 'file') {
            return { ok: false, error: appError('invalid_payload', 'file node data is immutable') }
          }
          if (existing.type === 'text') {
            const data = patch.data as { content?: unknown }
            if (typeof data.content !== 'string' || Object.keys(data).length !== 1) {
              return {
                ok: false,
                error: appError('invalid_payload', 'text node data must be { content }'),
              }
            }
          }
          if (existing.type === 'agent') {
            const data = patch.data as { title?: unknown }
            if (typeof data.title !== 'string' || Object.keys(data).length !== 1) {
              return {
                ok: false,
                error: appError('invalid_payload', 'agent node data must be { title }'),
              }
            }
          }
          if (existing.type === 'image') {
            const data = patch.data as { src?: unknown; alt?: unknown }
            if (Object.keys(data).some((key) => key !== 'src' && key !== 'alt')) {
              return {
                ok: false,
                error: appError('invalid_payload', 'image node data only allows src/alt'),
              }
            }
            if (
              data.src !== undefined &&
              (typeof data.src !== 'string' || !isValidImageSrc(data.src))
            ) {
              return { ok: false, error: appError('image_src_invalid', 'invalid image src') }
            }
            if (data.alt !== undefined && typeof data.alt !== 'string') {
              return { ok: false, error: appError('invalid_payload', 'image alt must be a string') }
            }
            if (typeof data.alt === 'string' && data.alt.length > 200) {
              return { ok: false, error: appError('invalid_payload', 'image alt is too long') }
            }
          }
          if (existing.type === 'group') {
            const data = patch.data as { label?: unknown; collapsed?: unknown }
            if (Object.keys(data).some((key) => key !== 'label' && key !== 'collapsed')) {
              return {
                ok: false,
                error: appError('invalid_payload', 'group node data only allows label/collapsed'),
              }
            }
            if (
              data.label !== undefined &&
              (typeof data.label !== 'string' ||
                data.label.trim().length === 0 ||
                data.label.length > 80)
            ) {
              return { ok: false, error: appError('invalid_payload', 'group label is invalid') }
            }
            if (data.collapsed !== undefined && typeof data.collapsed !== 'boolean') {
              return { ok: false, error: appError('invalid_payload', 'group collapsed is invalid') }
            }
          }
        }
        let next: Node
        const mergeable =
          existing.type === 'agent' || existing.type === 'image' || existing.type === 'group'
        const mergedData =
          mergeable && patch.data !== undefined
            ? {
                ...(existing.data as Record<string, unknown>),
                ...(patch.data as Record<string, unknown>),
              }
            : (patch.data ?? existing.data)
        try {
          next = Node.parse({
            ...existing,
            x: patch.x ?? existing.x,
            y: patch.y ?? existing.y,
            w: patch.w ?? existing.w,
            h: patch.h ?? existing.h,
            groupId: patch.groupId !== undefined ? patch.groupId : existing.groupId,
            data: mergedData,
            updatedAt: now(),
          })
        } catch {
          return { ok: false, error: appError('invalid_payload', 'invalid node patch') }
        }
        deps.db.transaction((tx) =>
          updateNode(tx, existing.id, {
            x: next.x,
            y: next.y,
            w: next.w,
            h: next.h,
            groupId: next.groupId,
            data: next.data,
            updatedAt: next.updatedAt,
          }),
        )
        return { ok: true, ack: { nodeId: existing.id } }
      }
      case 'node.delete': {
        const existing = getNode(deps.db, message.payload.nodeId)
        if (!existing) {
          return {
            ok: false,
            error: appError('node_not_found', 'node not found', {
              nodeId: message.payload.nodeId,
            }),
          }
        }
        if (hasTaskForNode(deps.db, existing.id)) {
          return {
            ok: false,
            error: appError('node_in_use', 'node is referenced by a task', {
              nodeId: existing.id,
              reference: 'task',
            }),
          }
        }
        let ungrouped = 0
        deps.db.transaction((tx) => {
          if (existing.type === 'group') ungrouped = ungroupChildren(tx, existing.id, now())
          deleteEdgesForNode(tx, existing.id)
          deleteNode(tx, existing.id)
        })
        return { ok: true, ack: { nodeId: existing.id, ungrouped } }
      }
      case 'edge.create': {
        const result = createEdge({ db: deps.db, newId }, message.payload)
        return result.ok
          ? { ok: true, ack: { edgeId: result.edgeId } }
          : { ok: false, error: result.error }
      }
      case 'edge.delete': {
        const result = deleteEdge({ db: deps.db }, message.payload)
        return result.ok ? { ok: true, ack: {} } : { ok: false, error: result.error }
      }
      case 'supervisor.send':
        return supervisor.send(message.payload)
      case 'resume': {
        const result = replay(message.payload.sinceSeq)
        const cursor = result.rows.at(-1)?.ordinal ?? eventStore.maxOrdinal()
        return {
          ok: true,
          ack: { cursor, hasMore: result.hasMore },
          replay: result.rows,
        }
      }
      case 'node.move_many': {
        try {
          const moved = deps.db.transaction((tx) =>
            moveNodes(tx, message.payload.canvasId, message.payload.moves, now()),
          )
          return { ok: true, ack: { moved } }
        } catch (error) {
          // 校验失败返回协议错误；未预期异常交给上层按 internal 处理。
          if (isAppError(error)) return { ok: false, error }
          throw error
        }
      }
      case 'group.create': {
        const canvas = getCanvas(deps.db, message.payload.canvasId)
        if (!canvas) {
          return {
            ok: false,
            error: appError('canvas_not_found', 'canvas not found', {
              canvasId: message.payload.canvasId,
            }),
          }
        }
        let group: Node
        try {
          group = Node.parse({
            id: newId(),
            canvasId: canvas.id,
            type: 'group',
            x: message.payload.x,
            y: message.payload.y,
            w: message.payload.w,
            h: message.payload.h,
            groupId: null,
            data: { label: message.payload.label, collapsed: false },
            createdAt: now(),
            updatedAt: now(),
          })
        } catch {
          return { ok: false, error: appError('group_invalid', 'invalid group payload') }
        }
        try {
          deps.db.transaction((tx) => createGroup(tx, canvas.id, group, message.payload.childIds))
        } catch (error) {
          if (isAppError(error)) return { ok: false, error }
          throw error
        }
        return {
          ok: true,
          ack: { groupId: group.id, children: message.payload.childIds.length },
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
      digestScheduler.start()
      schedulerHolder.value?.kick()
    },
    close: async () => {
      if (closing) {
        return
      }
      closing = true
      digestScheduler.stop()
      supervisor.close()
      await verifyHolder.value?.close()
      await sessionHolder.value?.close()
      await settle()
    },
    getTask: (id: string) => getTask(deps.db, id),
    getReviewByTask: (taskId: string) => getReviewByTask(deps.db, taskId),
    getSession: (id: string) => getSession(deps.db, id),
    countActiveTasks: () => countActiveTasks(deps.db),
    countLiveSessions: () => countLiveSessions(deps.db),
    findNextQueued,
    maxConcurrency: deps.config.maxConcurrency,
    maxLiveSessions: deps.config.maxLiveSessions,
    rescheduleDigest: () => rescheduleDigest(),
  }

  const created = createScheduler(runtime)
  schedulerHolder.value = created

  if (deps.adapters) {
    sessionHolder.value = createSessionRunner({
      db: deps.db,
      dataDir: deps.config.dataDir,
      adapters: deps.adapters,
      eventStore,
      broadcast: deps.broadcast,
      applyTransition,
      now,
      newId,
      killSwitch: () => automationState.isKillSwitchOn(),
    })
  }

  return { ...runtime, scheduler: created, supervisor, automation, digest }
}

export type Runtime = ReturnType<typeof createRuntime>
