import {
  DEFAULT_TASK_ACTIONS,
  buildMandate,
  buildTaskOrigin,
  canAcceptUserInput,
  templateById,
  validateMandate,
  validatePlanApply,
} from '@baton/core'
import { Node, TaskOrigin } from '@baton/protocol'
import type {
  AppError,
  ApprovalDecideInput,
  ClientMessage,
  ContextInjection,
  Engine,
  PlanApplyResult,
  ReviewDecideInput,
  Strength,
  SupervisorAction,
  TaskAction,
  TaskTransitionEvent,
} from '@baton/protocol'
import { randomUUID } from 'node:crypto'
import { createDigestService, type DigestServiceDeps } from '../automation/digest.js'
import { getAcceptanceResponse, type AcceptanceResponse } from '../acceptance/report-service.js'
import { createDigestScheduler, createTimeoutSchedule } from '../automation/scheduler.js'
import { createAutomationService } from '../automation/service.js'
import { createAutomationState } from '../automation/state.js'
import type { Config } from '../config.js'
import {
  createEventStore,
  type BroadcastEvent,
  type WsEventDraft,
  type WsEventRow,
} from '../db/event-store.js'
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
  getSupervisorMessageByTrigger,
  getTask,
  getTaskDetail,
  getWorkspace,
  hasTaskForNode,
  insertAudit,
  insertNode,
  listQueuedTasksByEnqueuedAt,
  listWorkspaces,
  moveNodes,
  ungroupChildren,
  updateApprovalResponse,
  updateNode,
  updateTaskOrigin,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError, isAppError, toAppError } from '../errors.js'
import type { Logger } from '../log.js'
import { createVerifyRunner, type VerifyRunner } from '../verify/runner.js'
import type { AdapterFactory } from './adapter-factory.js'
import { createContextService } from './context-service.js'
import { handleAcceptanceUpdate } from './acceptance-command.js'
import { createEdge, deleteEdge } from './edge-service.js'
import { createHandoffNode } from '../handoff/service.js'
import { createDeliveryService } from '../delivery/service.js'
import { createArtifactService } from '../artifact/service.js'
import { createAnnotationService } from '../annotation/service.js'
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
import { createSupervisorActionService } from '../supervisor/actions.js'
import { createTargetResolver } from '../supervisor/target.js'
import { loadWorkspacePolicy } from '../supervisor/autonomy.js'
import { PROMPT_VERSION } from '../supervisor/prompt.js'
import { createFailureService } from '../failures/service.js'
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
  const deliveryServiceHolder: { value?: ReturnType<typeof createDeliveryService> } = {}
  const annotationServiceHolder: { value?: ReturnType<typeof createAnnotationService> } = {}
  const artifactServiceHolder: { value?: ReturnType<typeof createArtifactService> } = {}
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
    onReviewReady: (taskId) => {
      try {
        deliveryServiceHolder.value?.maybeAutoApprove(taskId)
      } catch (error) {
        const failure = toAppError(error)
        deps.logger?.error(
          { event: 'delivery.auto_approve_failed', taskId, code: failure.code },
          'delivery auto approve failed',
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
  const contextService = createContextService({
    db: deps.db,
    config: deps.config,
    eventStore,
    applyTransition: (taskId, event) =>
      transitionRunnerHolder.value
        ? transitionRunnerHolder.value.applyTransition(taskId, event)
        : { ok: false, error: appError('runtime_not_ready', 'transition runner is not ready') },
    hasSession: (taskId) => sessionHolder.value?.has(taskId) ?? false,
    broadcast: deps.broadcast,
    now,
    newId,
  })
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
  const digestDeps: DigestServiceDeps = {
    db: deps.db,
    config: deps.config,
    eventStore,
    broadcast: deps.broadcast,
    now,
    newId,
  }
  const digest = createDigestService(digestDeps)
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
  const defaultEngine: Engine = 'claude-sdk'

  function requireMandate(taskId: string, action: TaskAction, strength: Strength): AppError | null {
    const detail = getTaskDetail(deps.db, taskId)
    if (!detail) return appError('task_not_found', 'task not found', { taskId })
    const origin = detail.task.origin
    if (!origin && strength === 'inferred') {
      return appError('mandate_revoked', 'task has no mandate', { reason: 'missing_mandate' })
    }
    if (!origin) return null
    const info = loadWorkspacePolicy(deps.db, deps.config, detail.task.workspaceId)
    if (!info) {
      return appError('workspace_not_found', 'workspace not found', {
        workspaceId: detail.task.workspaceId,
      })
    }
    const result = validateMandate({
      origin,
      requestedAction: action,
      requestedStrength: strength,
      currentPolicyVersion: info.policyVersion,
      gate: {
        workspaceTrusted: info.trusted,
        killSwitch: automationState.isKillSwitchOn(),
        autonomy: info.policy.autonomy.mode,
        capability:
          action === 'retry' ||
          action === 'reopen' ||
          action === 'enqueue' ||
          action === 'apply_plan'
            ? info.policy.autonomy.autoRetry
            : info.policy.autonomy.attentionReminder,
      },
    })
    return result.ok ? null : appError('mandate_revoked', 'task mandate revoked', result.detail)
  }

  function remindAttention(input: {
    workspaceId: string
    taskId: string
    kind: 'review' | 'failed'
    reason: string
  }): void {
    const info = loadWorkspacePolicy(deps.db, deps.config, input.workspaceId)
    if (!info) return
    const mode = info.attentionReminder(automationState.isKillSwitchOn())
    if (mode !== 'auto') return
    const day = Math.floor(now() / 86_400_000)
    const proposed = actions.propose({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      kind: 'attention_reminder',
      strength: 'inferred',
      mode: 'auto',
      reason: input.reason,
      payload: { taskId: input.taskId, attentionKind: input.kind },
      policyVersion: info.policyVersion,
      dedupeKey: `attention:${input.taskId}:${input.kind}:${day}`,
    })
    if (proposed.ok) {
      actions.decide({
        workspaceId: input.workspaceId,
        actionId: proposed.action.id,
        actor: 'system',
        decision: 'apply',
      })
    }
  }

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

  const failures = createFailureService({
    db: deps.db,
    now,
    newId,
    workspaceRoot: (workspaceId) => {
      const workspace = getWorkspace(deps.db, workspaceId)
      return workspace ? resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath) : null
    },
  })

  function planSourceText(nodeId: string): string | undefined {
    const node = getNode(deps.db, nodeId)
    return node?.type === 'text' ? node.data.content : undefined
  }

  function applyPlan(
    action: SupervisorAction,
  ): { ok: true; result: PlanApplyResult } | { ok: false; error: AppError } {
    const checked = validatePlanApply({
      action,
      now: now(),
      currentPolicyVersion:
        loadWorkspacePolicy(deps.db, deps.config, action.workspaceId)?.policyVersion ?? '',
    })
    if (!checked.ok) return { ok: false, error: appError(checked.code, checked.message) }
    const payload = checked.payload
    const sourceText =
      payload.source.nodeIds.length > 0
        ? planSourceText(payload.source.nodeIds[0]!)
        : getSupervisorMessageByTrigger(deps.db, action.threadId ?? '', payload.triggerId)?.content
    if (!sourceText?.trim()) {
      return { ok: false, error: appError('plan_invalid', 'plan source text is missing') }
    }
    const createdTaskIds: string[] = []
    const failed: PlanApplyResult['failed'] = []
    const resolver = createTargetResolver({
      db: deps.db,
      defaultEngine,
      now,
      newId,
    })
    // 计划里的多条任务通常共用一个 Agent；按 target/agentTitle 复用，避免建出同名节点。
    const sharedTargets = new Map<
      string,
      { id: string; title: string; engine: Engine; created: boolean }
    >()
    payload.items.forEach((item, index) => {
      try {
        const targetKey = item.targetNodeId ?? `agent:${item.agentTitle ?? item.title}`
        let target = sharedTargets.get(targetKey)
        if (!target) {
          target = resolver.resolveAgentTarget(
            {
              workspaceId: action.workspaceId,
              deliveryId: payload.deliveryId,
              stageKey: payload.stageKey,
              allowWorkspaceCanvas: !payload.deliveryId,
              selection: { contextNodeIds: [], agentCandidates: [] },
              memo: {},
            },
            {
              title: item.title,
              ...(item.targetNodeId ? { targetNodeId: item.targetNodeId } : {}),
              ...(item.agentTitle ? { agentTitle: item.agentTitle } : {}),
              ...(item.engine ? { engine: item.engine } : {}),
            },
          )
          sharedTargets.set(targetKey, target)
        }
        const template = templateById(item.templateId)
        const origin = buildTaskOrigin({
          source: 'supervisor-chat',
          triggerId: payload.triggerId,
          threadId: action.threadId ?? `plan:${action.id}`,
          workspaceId: action.workspaceId,
          targetNodeId: target.id,
          contextNodeIds: item.contextNodeIds,
          policyVersion: action.policyVersion,
          promptVersion: PROMPT_VERSION,
          createdAt: now(),
          ...(item.templateId ? { templateId: item.templateId } : {}),
          ...(template?.acceptanceSeed ? { acceptanceSeed: template.acceptanceSeed } : {}),
        })
        const sourceNodeId = payload.source.nodeIds[index]
        const itemPrompt = sourceNodeId ? (planSourceText(sourceNodeId) ?? sourceText) : sourceText
        const created = taskService.createTask(
          {
            workspaceId: action.workspaceId,
            nodeId: target.id,
            title: item.title,
            prompt: itemPrompt,
            contextNodeIds: item.contextNodeIds,
            engine: resolver.resolveEngine(item.engine ?? undefined, target),
            workspaceMode: 'main',
            dangerouslySkipPermissions: false,
            ...(payload.deliveryId ? { deliveryId: payload.deliveryId } : {}),
            ...(payload.stageKey ? { stageKey: payload.stageKey } : {}),
            ...(item.annotationIds ? { annotationIds: item.annotationIds } : {}),
          },
          {
            origin,
            audit: {
              actor: 'human',
              action: 'supervisor.plan.apply',
              detail: {
                actionId: action.id,
                index,
                templateId: item.templateId,
                ...(item.annotationIds ? { annotationIds: item.annotationIds } : {}),
              },
            },
          },
        )
        if (created.ok) createdTaskIds.push(created.taskId)
        else failed.push({ index, code: created.error.code, message: created.error.message })
      } catch (error) {
        const appErr = isAppError(error) ? error : toAppError(error)
        failed.push({ index, code: appErr.code, message: appErr.message })
      }
    })
    if (createdTaskIds.length === 0) {
      return {
        ok: false,
        error: appError('action_not_applicable', 'no plan item could be created', { failed }),
      }
    }
    return { ok: true, result: { createdTaskIds, failed } }
  }

  const actions = createSupervisorActionService({
    db: deps.db,
    now,
    newId,
    policyVersion: (workspaceId) =>
      loadWorkspacePolicy(deps.db, deps.config, workspaceId)?.policyVersion ?? '',
    requireMandate: (taskId, action, strength) => requireMandate(taskId, action, strength),
    applyTransition: (taskId, event) =>
      transitionRunnerHolder.value
        ? transitionRunnerHolder.value.applyTransition(taskId, event)
        : { ok: false, error: appError('runtime_not_ready', 'transition runner is not ready') },
    enqueueTask: (taskId) => {
      const outcome = enqueue(taskId)
      return outcome.ok ? { ok: true, status: outcome.status } : { ok: false, error: outcome.error }
    },
    generateDigest: (workspaceId) => digest.generate(workspaceId, 'attention'),
    applyPlan,
  })
  digestDeps.actions = actions
  digestDeps.failures = failures

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
    injectContext: contextService.injectContext,
    cancelTask: cancel,
    workspacesRoot: deps.config.workspacesRoot,
    killSwitch: () => automationState.isKillSwitchOn(),
    actions,
    failures,
    deliveries: () => deliveryServiceHolder.value,
    annotations: () => annotationServiceHolder.value,
    artifacts: () => artifactServiceHolder.value,
    remindAttention,
    loadPolicy: (workspaceId) => loadWorkspacePolicy(deps.db, deps.config, workspaceId),
    requireMandate: (taskId, action, strength) => requireMandate(taskId, action, strength),
    ...(deps.supervisorEngine ? { engine: deps.supervisorEngine } : {}),
    now,
    newId,
    ...(deps.logger ? { logger: deps.logger } : {}),
    ...(deps.broadcastRaw ? { broadcastRaw: deps.broadcastRaw } : {}),
    track: hooks.track,
  })
  supervisorHolder.value = supervisor
  digestDeps.deliver = (input) => supervisor.deliverDigest(input)
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

  /** 先落 ws_event 再广播；事务提交后才推送，避免客户端看到回滚事件。 */
  function publish(draft: WsEventDraft): void {
    const event = deps.db.transaction((tx) => eventStore.appendWs(tx, draft))
    deps.broadcast(event)
  }

  const artifacts = createArtifactService({
    db: deps.db,
    config: deps.config,
    now,
    newId,
    emit: publish,
  })
  artifactServiceHolder.value = artifacts
  deliveryServiceHolder.value = createDeliveryService({
    db: deps.db,
    config: deps.config,
    now,
    newId,
    applyTransition,
    killSwitch: () => automationState.isKillSwitchOn(),
    emit: publish,
    checkArtifacts: artifacts.checkRequiredArtifacts,
  })
  annotationServiceHolder.value = createAnnotationService({
    db: deps.db,
    config: deps.config,
    now,
    newId,
    emit: publish,
  })

  if (!deps.runVerify) {
    verifyHolder.value = createVerifyRunner({
      db: deps.db,
      config: deps.config,
      applyTransition,
      now,
      newId,
      verifyMeta,
      failures,
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
    if (!outcome.ok) return outcome
    if (outcome.previousStatus === 'verifying') {
      verifyHolder.value?.cancel(taskId)
    }
    const task = getTask(deps.db, taskId)
    if (task?.deliveryId && task.stageKey) {
      try {
        const cascade = deliveryServiceHolder.value?.markDeliveryCancelled(task.deliveryId, {
          actor: 'system',
          source: 'task_cancel',
          ...(reason ? { reason } : {}),
          taskId,
        })
        if (cascade && !cascade.ok) {
          deps.logger?.warn(
            { event: 'delivery_cancel_cascade_failed', taskId, code: cascade.code },
            'delivery cancel cascade failed',
          )
        }
      } catch (error) {
        deps.logger?.warn(
          { event: 'delivery_cancel_cascade_failed', taskId, error: String(error) },
          'delivery cancel cascade failed',
        )
      }
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

  function recordReviewDecision(input: {
    taskId: string
    reviewId: string
    decision: 'approve' | 'reject'
    acceptance: AcceptanceResponse | null
    overrideReason?: string
  }): void {
    const overrideReason = input.overrideReason?.trim()
    // 旧 review 没有 AC，也没写 override 时不强行补审计；新决策都有合同。
    if (!input.acceptance && !overrideReason) return
    const at = now()
    deps.db.transaction((tx) => {
      insertAudit(tx, {
        id: newId(),
        ts: at,
        actor: 'human',
        action: 'review.decide',
        detail: {
          taskId: input.taskId,
          reviewId: input.reviewId,
          decision: input.decision,
          ...(input.acceptance
            ? {
                contractId: input.acceptance.contract.id,
                version: input.acceptance.contract.version,
                revision: input.acceptance.contract.revision,
                reportHash: input.acceptance.report.hash,
                counts: input.acceptance.report.acceptance.counts,
                verdict: input.acceptance.report.acceptance.verdict,
              }
            : {}),
          ...(overrideReason ? { overrideReason } : {}),
        },
      })
    })
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
    const task = getTask(deps.db, review.taskId)
    const acceptance = task ? getAcceptanceResponse(deps.db, task, deps.config) : null
    if (input.decision === 'approve') {
      const counts = acceptance?.report.acceptance.counts
      const overrideRequired =
        !acceptance ||
        (counts?.total ?? 0) === 0 ||
        (counts?.fail ?? 0) > 0 ||
        (counts?.pending ?? 0) > 0
      if (overrideRequired && !input.overrideReason?.trim()) {
        return {
          ok: false,
          error: appError(
            'acceptance_override_reason_required',
            'acceptance override reason is required',
            {
              taskId: review.taskId,
              counts,
              verdict: acceptance?.report.acceptance.verdict ?? 'incomplete',
            },
          ),
        }
      }
      if (task?.deliveryId && task.stageKey) {
        const checked = deliveryServiceHolder.value?.checkStageArtifacts(
          task.deliveryId,
          task.stageKey,
        )
        if (checked && !checked.ok) {
          return {
            ok: false,
            error: appError('artifact_missing', 'required artifacts are missing', {
              taskId: task.id,
              missing: checked.missing,
            }),
          }
        }
      }
      const reasonProvided = Boolean(input.reason?.trim())
      const override =
        reasonProvided || review.verifyExitCode !== 0
          ? { verifyExitCode: review.verifyExitCode, reasonProvided }
          : undefined
      const outcome = applyTransition(review.taskId, {
        type: 'approve',
        reviewId: input.reviewId,
        ...(override ? { override } : {}),
      })
      if (outcome.ok) {
        recordReviewDecision({
          taskId: review.taskId,
          reviewId: input.reviewId,
          decision: 'approve',
          acceptance,
          ...(input.overrideReason ? { overrideReason: input.overrideReason } : {}),
        })
        const reviewed = getTask(deps.db, review.taskId)
        if (reviewed?.deliveryId && reviewed.stageKey) {
          try {
            deliveryServiceHolder.value?.advanceDelivery(reviewed.deliveryId, reviewed.stageKey)
          } catch (error) {
            const failure = toAppError(error)
            deps.logger?.error(
              {
                event: 'delivery.advance_failed',
                taskId: reviewed.id,
                deliveryId: reviewed.deliveryId,
                code: failure.code,
              },
              'failed to advance delivery',
            )
          }
        }
      }
      return outcome
    }
    let contextInjection: ContextInjection | undefined
    let contextBlock: string | undefined
    if (input.contextNodeIds?.length) {
      const prepared = contextService.prepareContextInjection(
        {
          taskId: review.taskId,
          nodeIds: input.contextNodeIds,
          ...(input.contextNote ? { note: input.contextNote } : {}),
          source: 'user',
          actor: 'user',
        },
        { allowReview: true },
      )
      if (!prepared.ok) return prepared
      contextInjection = prepared.injection
      contextBlock = prepared.block
    }
    const outcome = applyTransition(review.taskId, {
      type: 'reject',
      reviewId: input.reviewId,
      feedback: input.feedback?.trim() || '请结合补充的上下文修改',
      ...(contextInjection && contextBlock ? { contextInjection, contextBlock } : {}),
    })
    if (outcome.ok) {
      recordReviewDecision({
        taskId: review.taskId,
        reviewId: input.reviewId,
        decision: 'reject',
        acceptance,
      })
    }
    return outcome
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
      case 'task.enqueue': {
        const mandate = requireMandate(message.payload.taskId, 'enqueue', 'explicit')
        if (mandate) return { ok: false, error: mandate }
        return ackFromOutcome(enqueue(message.payload.taskId))
      }
      case 'task.cancel':
        return ackFromOutcome(cancel(message.payload.taskId, message.payload.reason))
      case 'task.retry': {
        const mandate = requireMandate(message.payload.taskId, 'retry', 'explicit')
        if (mandate) return { ok: false, error: mandate }
        return ackFromOutcome(
          applyTransition(message.payload.taskId, {
            type: 'retry',
            ...(message.payload.note ? { note: message.payload.note } : {}),
          }),
        )
      }
      case 'task.reopen': {
        const mandate = requireMandate(message.payload.taskId, 'reopen', 'explicit')
        if (mandate) return { ok: false, error: mandate }
        return ackFromOutcome(
          applyTransition(message.payload.taskId, {
            type: 'reopen',
            ...(message.payload.note ? { note: message.payload.note } : {}),
          }),
        )
      }
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
      case 'context.inject': {
        const result = contextService.injectContext({
          taskId: message.payload.taskId,
          nodeIds: message.payload.nodeIds,
          ...(message.payload.note ? { note: message.payload.note } : {}),
          ...(message.payload.requestId ? { requestId: message.payload.requestId } : {}),
          source: 'user',
          actor: 'human',
        })
        return result.ok
          ? {
              ok: true,
              ack: {
                taskId: result.taskId,
                seq: result.seq,
                truncated: result.truncated,
                dropped: result.dropped,
                ...(result.duplicate ? { duplicate: true } : {}),
              },
            }
          : { ok: false, error: result.error }
      }
      case 'acceptance.update':
        return handleAcceptanceUpdate(
          {
            db: deps.db,
            eventStore,
            now,
            newId,
            ...(deps.broadcastRaw ? { broadcastRaw: deps.broadcastRaw } : {}),
          },
          message.payload,
        )
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
        // Node 协议是封闭 union；未知类型在 getNode 解析阶段就会失败。
        if (patch.data !== undefined) {
          if (typeof patch.data !== 'object' || patch.data === null || Array.isArray(patch.data)) {
            return { ok: false, error: appError('invalid_payload', 'node data must be an object') }
          }
          if (
            existing.type === 'file' ||
            existing.type === 'review' ||
            existing.type === 'artifact' ||
            existing.type === 'drawing'
          ) {
            // 这些节点的 data 由 artifact/task 派生，只允许移动与分组，不能手改内容。
            return {
              ok: false,
              error: appError('invalid_payload', `${existing.type} node data is immutable`),
            }
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
      case 'supervisor.action.decide': {
        const result = actions.decide({
          workspaceId: message.payload.workspaceId,
          actionId: message.payload.actionId,
          actor: 'human',
          decision: message.payload.decision,
        })
        return result.ok
          ? {
              ok: true,
              ack: {
                actionId: result.action.id,
                status: result.action.status,
                result: result.action.result,
              },
            }
          : { ok: false, error: result.error }
      }
      case 'task.reauthorize': {
        const detail = getTaskDetail(deps.db, message.payload.taskId)
        if (!detail) {
          return {
            ok: false,
            error: appError('task_not_found', 'task not found', {
              taskId: message.payload.taskId,
            }),
          }
        }
        const task = detail.task
        if (!task.nodeId) {
          return {
            ok: false,
            error: appError('task_not_applicable', 'task has no node to authorize', {
              taskId: task.id,
            }),
          }
        }
        const info = loadWorkspacePolicy(deps.db, deps.config, task.workspaceId)
        if (!info) {
          return {
            ok: false,
            error: appError('workspace_not_found', 'workspace not found', {
              workspaceId: task.workspaceId,
            }),
          }
        }
        const mandate = buildMandate({
          strength: 'explicit',
          allowedActions: DEFAULT_TASK_ACTIONS,
          policyVersion: info.policyVersion,
          promptVersion: PROMPT_VERSION,
        })
        const nextOrigin = TaskOrigin.parse({
          ...(task.origin ??
            buildTaskOrigin({
              source: 'canvas',
              triggerId: `reauthorize:${task.id}`,
              threadId: `reauthorize:${task.id}`,
              workspaceId: task.workspaceId,
              targetNodeId: task.nodeId,
              contextNodeIds: task.context?.included.map((item) => item.id) ?? [],
              policyVersion: info.policyVersion,
              promptVersion: PROMPT_VERSION,
              createdAt: now(),
            })),
          ...mandate,
        })
        deps.db.transaction((tx) => {
          updateTaskOrigin(tx, task.id, JSON.stringify(nextOrigin), now())
          insertAudit(tx, {
            id: newId(),
            ts: now(),
            actor: 'human',
            action: 'supervisor.mandate.reauthorize',
            detail: {
              taskId: task.id,
              workspaceId: task.workspaceId,
              mandateVersion: mandate.mandateVersion,
            },
          })
        })
        return {
          ok: true,
          ack: { taskId: task.id, mandateVersion: mandate.mandateVersion },
        }
      }
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
      default:
        return {
          ok: false,
          error: appError(
            'unsupported_command',
            `unsupported command: ${(message as { type: string }).type}`,
          ),
        }
    }
  }

  function findNextQueued(exclude?: ReadonlySet<string>): { id: string } | null {
    const next = listQueuedTasksByEnqueuedAt(deps.db).find((task) => !exclude?.has(task.id))
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
    publish,
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
      failures,
      onTaskCompleted: (taskId) => {
        const task = getTask(deps.db, taskId)
        if (task?.deliveryId && task.stageKey) {
          deliveryServiceHolder.value?.syncStageArtifacts(task.deliveryId, task.stageKey)
        }
      },
    })
  }

  return {
    ...runtime,
    scheduler: created,
    supervisor,
    automation,
    digest,
    actions,
    failures,
    artifacts,
  }
}

export type Runtime = ReturnType<typeof createRuntime>
