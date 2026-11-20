import { buildTaskOrigin, SUPERVISOR_POLICY, supervisorPolicyVersion } from '@baton/core'
import {
  Node,
  SupervisorTaskCard,
  VERIFY_SKIPPED,
  type AppError,
  type Engine as EngineValue,
  type Review,
  type SupervisorMessage,
  type SupervisorMessagesResponse,
  type SupervisorSendInput,
  type SupervisorStatusResponse,
  type TaskDetail,
  type TaskOrigin,
  type TaskTransitionEvent,
  type TaskStatus,
  type WaitingReason,
} from '@baton/protocol'
import {
  countEdges,
  findActiveVerifierIdsForTarget,
  getCanvasByWorkspace,
  getAssistantTranscriptText,
  getLastAssistantText,
  getReviewByTask,
  getSessionOutcomeReason,
  getTaskDetail,
  getWorkspace,
  insertAudit,
  insertNode,
  listNodes,
  listSessionsByTask,
  updateTaskWorktreePath,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError, isAppError } from '../errors.js'
import type { Logger } from '../log.js'
import type { TaskService } from '../runtime/task-service.js'
import type { TransitionOutcome } from '../runtime/types.js'
import { canvasOverviewXml, nodeTitle } from './canvas-summary.js'
import { loadSupervisorConfig, type SupervisorConfig } from './config.js'
import { createAiSdkSupervisorEngine, type SupervisorEngine } from './engine.js'
import { buildVerifierPrompt, parseVerdict } from './observe.js'
import { PROMPT_VERSION, REPORT_PROMPT, SUPERVISOR_PROMPT } from './prompt.js'
import { createSupervisorStore } from './store.js'
import { xmlEscape } from './xml.js'
import {
  bindTools,
  createSupervisorTools,
  type BoundTool,
  type BoundToolset,
  type EnqueueTaskResult,
  type ToolContext,
} from './tools.js'

export type SupervisorSendResult =
  { ok: true; ack: { threadId: string; messageId: string } } | { ok: false; error: AppError }

export interface SupervisorServiceDeps {
  db: Db
  dataDir: string
  taskService: TaskService
  defaultEngine: EngineValue
  enqueueTask: (taskId: string) => EnqueueTaskResult
  applyTransition: (taskId: string, event: TaskTransitionEvent) => TransitionOutcome
  replyToTask: (taskId: string, text: string) => { ok: boolean; error?: AppError }
  cancelTask: (taskId: string, reason?: string) => TransitionOutcome
  workspacesRoot: string
  killSwitch: () => boolean
  engine?: SupervisorEngine
  now: () => number
  newId: () => string
  logger?: Logger
  broadcastRaw?: (frame: string) => void
  track?: (action: () => void | Promise<void>) => void
}

export interface ObserveTaskInput {
  taskId: string
  status: TaskStatus
  waitingReason: WaitingReason | null
}

function trimHistory(messages: SupervisorMessage[], maxChars = 32_000): SupervisorMessage[] {
  let total = 0
  const kept: SupervisorMessage[] = []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (kept.length > 0 && total + message.content.length > maxChars) break
    total += message.content.length
    kept.unshift(message)
  }
  return kept
}

function candidateCard(input: {
  workspaceName: string
  workspaceId: string
  threadId: string
  text: string
  nodes: Node[]
  canvasNodes: Node[]
  edgeCount: number
  targetNodeId?: string
  policyVersion: string
  defaultEngine: string
}): string {
  const selected = input.nodes
    .map(
      (node) =>
        `  <node id="${xmlEscape(node.id)}" type="${node.type}" title="${xmlEscape(nodeTitle(node))}" />`,
    )
    .join('\n')
  const agents = input.nodes
    .filter((node) => node.type === 'agent')
    .map(
      (node) =>
        `  <agent id="${xmlEscape(node.id)}" title="${xmlEscape(nodeTitle(node))}" engine="${node.data.engine}" />`,
    )
    .join('\n')
  const target = input.targetNodeId
    ? `\n<target_agent id="${xmlEscape(input.targetNodeId)}" />`
    : ''
  return `<workspace id="${xmlEscape(input.workspaceId)}" name="${xmlEscape(input.workspaceName)}" />
<thread id="${xmlEscape(input.threadId)}" />
<user_message>${xmlEscape(input.text)}</user_message>
${canvasOverviewXml(input.canvasNodes, input.edgeCount)}
<selection>
${selected}
</selection>
<agent_candidates>
${agents}
</agent_candidates>${target}
<default_engine>${xmlEscape(input.defaultEngine)}</default_engine>
<mode>explicit</mode>
<policy_version>${xmlEscape(input.policyVersion)}</policy_version>`
}

export function createSupervisorService(deps: SupervisorServiceDeps) {
  const store = createSupervisorStore({ db: deps.db, now: deps.now, newId: deps.newId })
  const tools = createSupervisorTools({
    db: deps.db,
    workspacesRoot: deps.workspacesRoot,
    taskService: deps.taskService,
    now: deps.now,
    newId: deps.newId,
    defaultEngine: deps.defaultEngine,
    enqueueTask: deps.enqueueTask,
    applyTransition: deps.applyTransition,
    replyToTask: deps.replyToTask,
    cancelTask: deps.cancelTask,
  })
  const policyVersion = supervisorPolicyVersion(SUPERVISOR_POLICY, PROMPT_VERSION)
  const active = new Set<string>()
  const controllers = new Map<string, AbortController>()
  const polishControllers = new Set<AbortController>()
  let polishInFlight = 0
  const idleWaiters: Array<() => void> = []
  const track = deps.track ?? ((action: () => void | Promise<void>) => void action())

  function emit(type: string, id: string, payload: unknown): void {
    deps.broadcastRaw?.(JSON.stringify({ v: 1, id, type, ts: deps.now(), payload }))
  }

  function wrapTool(
    name: keyof BoundToolset,
    tool: BoundTool,
    messageId: string,
    threadId: string,
  ): BoundTool {
    let callSeq = 0
    return {
      description: tool.description,
      parameters: tool.parameters,
      async execute(input) {
        // 同一轮可能多次调用同一工具；每次执行必须有独立 id，否则前端会合并工具卡。
        const toolCallId = `${messageId}:${name}:${++callSeq}`
        emit('supervisor.tool', toolCallId, {
          threadId,
          messageId,
          toolCallId,
          name,
          phase: 'start',
        })
        try {
          const result = await tool.execute(input)
          emit('supervisor.tool', toolCallId, {
            threadId,
            messageId,
            toolCallId,
            name,
            phase: 'end',
            ok: true,
          })
          return result
        } catch (error) {
          emit('supervisor.tool', toolCallId, {
            threadId,
            messageId,
            toolCallId,
            name,
            phase: 'end',
            ok: false,
            summary: error instanceof Error ? error.message : 'tool failed',
          })
          throw error
        }
      },
    }
  }

  function reportEngine(): SupervisorEngine | null {
    // 注入的引擎若没有 summarize（测试/自定义），保留模板，绝不偷偷换真实模型。
    if (deps.engine) return deps.engine
    const loaded = loadSupervisorConfig(deps.dataDir)
    return loaded.ok ? createAiSdkSupervisorEngine(loaded.config) : null
  }

  /** 先落模板保证即时可见，再异步润色；失败或超时都保留模板。 */
  function polishNotification(messageId: string, template: string): void {
    if (deps.killSwitch() || polishInFlight >= 2) return
    const engine = reportEngine()
    if (!engine?.summarize) return
    polishInFlight += 1
    const controller = new AbortController()
    polishControllers.add(controller)
    const timeout = setTimeout(() => controller.abort(), 20_000)
    track(async () => {
      try {
        const text = (
          await engine.summarize!({
            system: REPORT_PROMPT,
            prompt: template,
            signal: controller.signal,
          })
        ).trim()
        if (!text) return
        const updated = store.updateNotificationContent(messageId, text)
        if (updated) emit('supervisor.message', updated.id, updated)
      } catch (error) {
        deps.logger?.warn(
          {
            event: 'supervisor.polish_failed',
            messageId,
            message: error instanceof Error ? error.message : 'unknown error',
          },
          'supervisor notification polish failed',
        )
      } finally {
        polishInFlight -= 1
        clearTimeout(timeout)
        polishControllers.delete(controller)
      }
    })
  }

  function notify(threadId: string, key: string, content: string): void {
    try {
      const result = store.insertNotification({ threadId, dedupeKey: key, content })
      if (result.duplicate) return
      emit('supervisor.message', result.message.id, result.message)
      polishNotification(result.message.id, content)
    } catch (error) {
      deps.logger?.warn(
        {
          event: 'supervisor.notify_failed',
          threadId,
          message: error instanceof Error ? error.message : 'unknown error',
        },
        'supervisor notification failed',
      )
    }
  }

  function createVerifierAgent(task: TaskDetail): { id: string; title: string } {
    const canvas = getCanvasByWorkspace(deps.db, task.workspaceId)
    if (!canvas) throw appError('canvas_not_found', 'canvas not found', { taskId: task.id })
    const nodes = listNodes(deps.db, canvas.id)
    const y = nodes.reduce((max, node) => Math.max(max, node.y + node.h), 40) + 24
    const title = `验收员 · ${task.title}`.slice(0, 80)
    const ts = deps.now()
    const node = Node.parse({
      id: deps.newId(),
      canvasId: canvas.id,
      type: 'agent',
      x: 80,
      y,
      w: 320,
      h: 200,
      groupId: null,
      data: { title, engine: deps.defaultEngine, taskId: null },
      createdAt: ts,
      updatedAt: ts,
    })
    deps.db.transaction((tx) => insertNode(tx, node))
    return { id: node.id, title }
  }

  function diffText(review: Review): string {
    return review.diffStat
      ? `${review.diffStat.filesChanged} 个文件，+${review.diffStat.insertions}/-${review.diffStat.deletions}`
      : '没有 diff 快照'
  }

  /**
   * 总管不亲自验收：为这一轮 review 派一个新的验收 Agent 任务。
   * 验收员只拿任务元数据、verify/diff 摘要和工人最后回复，不拿完整 transcript。
   */
  function dispatchVerifier(task: TaskDetail, origin: TaskOrigin, review: Review): void {
    const dedupeKey = `observe:dispatch:${task.id}:${review.id}`
    if (store.hasNotification(origin.threadId, dedupeKey)) return
    if (deps.killSwitch()) {
      notify(
        origin.threadId,
        dedupeKey,
        `自动化已暂停。任务「${task.title}」仍在待验收，等你决定。`,
      )
      return
    }
    const isolated = task.workspaceMode === 'worktree'
    if (isolated && !task.worktreePath) {
      notify(
        origin.threadId,
        `observe:review:${task.id}:${review.id}`,
        `任务「${task.title}」进入待验收，但 worktree 路径缺失，无法派验收员；需要你确认。`,
      )
      return
    }

    let agent: { id: string; title: string }
    try {
      agent = createVerifierAgent(task)
    } catch (error) {
      notify(
        origin.threadId,
        `observe:review:${task.id}:${review.id}`,
        `任务「${task.title}」进入待验收，但验收员 Agent 创建失败：${
          error instanceof Error ? error.message : '未知错误'
        }。`,
      )
      return
    }

    const session = listSessionsByTask(deps.db, task.id).at(-1)
    const workerOutput = session ? getLastAssistantText(deps.db, session.id) : ''
    const prompt = buildVerifierPrompt({
      title: task.title,
      taskId: task.id,
      prompt: task.prompt,
      workerOutput,
      verifyExitCode: review.verifyExitCode,
      diffStat: review.diffStat,
      isolatedWorktree: isolated,
    })
    const created = deps.taskService.createTask(
      {
        workspaceId: task.workspaceId,
        nodeId: agent.id,
        title: `验收：${task.title}`.slice(0, 80),
        prompt,
        contextNodeIds: [],
        engine: deps.defaultEngine,
        workspaceMode: task.workspaceMode,
        dangerouslySkipPermissions: false,
      },
      {
        origin: buildTaskOrigin({
          source: 'supervisor-review',
          triggerId: origin.triggerId,
          threadId: origin.threadId,
          workspaceId: task.workspaceId,
          targetNodeId: agent.id,
          contextNodeIds: [],
          policyVersion,
          promptVersion: PROMPT_VERSION,
          createdAt: deps.now(),
          actorKind: 'system',
          reviewOfTaskId: task.id,
          reviewOfReviewId: review.id,
        }),
        audit: {
          actor: 'supervisor',
          action: 'supervisor.review.dispatch',
          detail: {
            targetTaskId: task.id,
            reviewId: review.id,
            verifierAgentId: agent.id,
            policyVersion,
          },
        },
      },
    )
    if (!created.ok) {
      notify(
        origin.threadId,
        `observe:review:${task.id}:${review.id}`,
        `任务「${task.title}」进入待验收，但验收任务创建失败：${created.error.message}。`,
      )
      return
    }

    // 验收员借用目标的 worktree：目标已在 review，不会并发写；复用路径让验收员能看到未提交改动。
    if (isolated && task.worktreePath) {
      updateTaskWorktreePath(
        deps.db,
        created.taskId,
        task.worktreePath,
        deps.now(),
        task.branch ?? null,
      )
    }

    const enqueued = deps.enqueueTask(created.taskId)
    const startNote = enqueued.ok ? '验收员已开工。' : `验收员开工失败：${enqueued.error.message}。`
    notify(
      origin.threadId,
      dedupeKey,
      `任务「${task.title}」进入待验收。\n` +
        `verify 退出码：${review.verifyExitCode ?? '未执行'}；diff：${diffText(review)}。\n` +
        `我已派出新 Agent「${agent.title}」做初步验收，${startNote}最终通过仍由你决定。`,
    )
  }

  /** 验收员任务进入 review：读出 VERDICT，关闭验收任务，再按授权决定是否通过目标任务。 */
  function finishVerifier(task: TaskDetail): void {
    const origin = task.origin
    if (!origin?.reviewOfTaskId || !origin.reviewOfReviewId) return
    const verifierReview = getReviewByTask(deps.db, task.id)
    if (!verifierReview) {
      recoverVerifier(task, '验收员任务没有 review 记录')
      return
    }
    const session = listSessionsByTask(deps.db, task.id).at(-1)
    const output = session ? getAssistantTranscriptText(deps.db, session.id) : ''
    const outcomeReason = session ? getSessionOutcomeReason(deps.db, session.id) : null
    const parsed = parseVerdict(output, outcomeReason)

    // 验收员任务本身不需要人再验收；它的产出就是结论。
    const closed = deps.applyTransition(task.id, {
      type: 'approve',
      reviewId: verifierReview.id,
    })
    if (!closed.ok) {
      deps.logger?.warn(
        { event: 'supervisor.verifier_close_failed', taskId: task.id, code: closed.error.code },
        'failed to close verifier task',
      )
    }
    concludeVerifier(task, parsed, origin)
  }

  /**
   * Claude 有时结束回合但没上报 outcome，任务会停在 waiting_input(stalled)。
   * 只要 transcript 里已有明确 VERDICT，就按结论收口，避免总管链路被卡住。
   */
  function recoverVerifier(task: TaskDetail, fallbackReason: string): void {
    const origin = task.origin
    if (!origin?.reviewOfTaskId || !origin.reviewOfReviewId) return
    const session = listSessionsByTask(deps.db, task.id).at(-1)
    const output = session ? getAssistantTranscriptText(deps.db, session.id) : ''
    const outcomeReason = session ? getSessionOutcomeReason(deps.db, session.id) : null
    const parsed = parseVerdict(output, outcomeReason)
    if (parsed.verdict === 'unknown') {
      notify(
        origin.threadId,
        `observe:verifier:${task.id}:waiting:${task.updatedAt}`,
        `验收员任务「${task.title}」${fallbackReason}，且没有给出 VERDICT；目标任务仍在待验收，等你决定。`,
      )
      return
    }
    // waiting_input / 无 review 的验收员任务无法 approve；用 cancel 收口，结论仍按 transcript 处理。
    const closed = deps.applyTransition(task.id, {
      type: 'cancel',
      reason: 'verifier verdict recovered from transcript',
    })
    if (!closed.ok) {
      deps.logger?.warn(
        { event: 'supervisor.verifier_cancel_failed', taskId: task.id, code: closed.error.code },
        'failed to close stalled verifier task',
      )
    }
    concludeVerifier(task, parsed, origin)
  }

  function concludeVerifier(
    task: TaskDetail,
    parsed: ReturnType<typeof parseVerdict>,
    origin: TaskOrigin,
  ): void {
    const threadId = origin.threadId
    const targetTaskId = origin.reviewOfTaskId
    const reviewId = origin.reviewOfReviewId
    if (!targetTaskId || !reviewId) return
    const conclusion =
      parsed.verdict === 'pass' ? 'PASS' : parsed.verdict === 'fail' ? 'FAIL' : '没有给出明确结论'

    const targetDetail = getTaskDetail(deps.db, targetTaskId)
    if (!targetDetail) {
      notify(
        threadId,
        `observe:verdict:${task.id}`,
        `验收员结论：${conclusion}。目标任务已不存在。\n${parsed.reason}`,
      )
      return
    }
    const target = targetDetail.task
    const currentReview = getReviewByTask(deps.db, target.id)
    if (target.status !== 'review' || !currentReview || currentReview.id !== reviewId) {
      notify(
        threadId,
        `observe:verdict:${task.id}`,
        `验收员任务「${task.title}」结论：${conclusion}。\n` +
          `目标任务「${target.title}」已是 ${target.status} 或进入了新轮次，本次结论仅作参考。\n` +
          parsed.reason,
      )
      return
    }

    deps.db.transaction((tx) =>
      insertAudit(tx, {
        id: deps.newId(),
        ts: deps.now(),
        actor: 'supervisor',
        action: 'supervisor.review.recommend',
        detail: {
          taskId: target.id,
          reviewId,
          verifierTaskId: task.id,
          verdict: conclusion,
          verifyExitCode: currentReview.verifyExitCode,
          policyVersion,
        },
      }),
    )

    if (parsed.verdict !== 'pass') {
      notify(
        threadId,
        `observe:verdict:${task.id}`,
        `验收员对「${target.title}」的初步验收结论是 ${conclusion}，建议打回。\n` +
          `任务仍在待验收，最终由你决定。\n${parsed.reason}`,
      )
      return
    }

    // 未执行自动校验时不能把主观 PASS 当成机器通过。
    if (currentReview.verifyExitCode === VERIFY_SKIPPED) {
      notify(
        threadId,
        `observe:verdict:${task.id}`,
        `验收员初步验收为 PASS，但目标任务没有执行自动 verify（工作区未配置命令），` +
          `建议你人工确认。\n任务仍在待验收，最终由你决定。\n${parsed.reason}`,
      )
      return
    }

    // 机器证据优先：verify 没过时，验收员的主观 PASS 只能作为参考。
    if (currentReview.verifyExitCode !== 0) {
      notify(
        threadId,
        `observe:verdict:${task.id}`,
        `验收员初步验收为 PASS，但目标任务 verify 退出码是 ${
          currentReview.verifyExitCode ?? '未执行'
        }，建议你先确认失败原因。\n任务仍在待验收，最终由你决定。\n${parsed.reason}`,
      )
      return
    }

    notify(
      threadId,
      `observe:verdict:${task.id}`,
      `验收员对「${target.title}」的初步验收结论是 PASS，建议通过。\n` +
        `任务仍在待验收，等你最终确认后才会完成。\n${parsed.reason}`,
    )
  }

  /**
   * 目标离开 review（通过/打回/重开/取消）后，这一轮的验收结论已经失效。
   * 取消仍在跑的验收员，避免它继续读取或与目标任务共用同一个 worktree。
   */
  function cancelVerifiersForTarget(targetTaskId: string): void {
    for (const verifierTaskId of findActiveVerifierIdsForTarget(deps.db, targetTaskId)) {
      const outcome = deps.applyTransition(verifierTaskId, {
        type: 'cancel',
        reason: 'target task left review',
      })
      if (!outcome.ok) {
        deps.logger?.warn(
          {
            event: 'supervisor.verifier_cancel_failed',
            taskId: verifierTaskId,
            code: outcome.error.code,
          },
          'failed to cancel stale verifier',
        )
      }
    }
  }

  function observeTask(input: ObserveTaskInput): void {
    const detail = getTaskDetail(deps.db, input.taskId)
    const task = detail?.task
    const origin = task?.origin
    if (!task || !origin) return

    if (origin.source === 'supervisor-review') {
      if (input.status === 'review') {
        finishVerifier(task)
        return
      }
      if (input.status === 'failed') {
        notify(
          origin.threadId,
          `observe:verifier:${task.id}:failed:${task.updatedAt}`,
          `验收员任务「${task.title}」执行失败，目标任务仍在待验收。请查看任务详情。`,
        )
        return
      }
      if (input.status === 'waiting_input' && input.waitingReason !== 'approval') {
        recoverVerifier(task, `停在等待输入（${input.waitingReason ?? '未知原因'}）`)
      }
      return
    }

    if (origin.source !== 'supervisor-chat') return

    if (input.status === 'review') {
      const review = getReviewByTask(deps.db, task.id)
      if (!review) return
      // 验收员只做初步检查；最终通过仍由人决定。
      dispatchVerifier(task, origin, review)
      return
    }

    if (input.status === 'failed') {
      notify(
        origin.threadId,
        `observe:failed:${task.id}:${task.retryCount}`,
        `任务「${task.title}」执行失败，需要你看一下任务详情。`,
      )
      return
    }

    if (input.status === 'waiting_input' && input.waitingReason !== 'approval') {
      notify(
        origin.threadId,
        `observe:waiting:${task.id}:${input.waitingReason ?? 'unknown'}:${task.updatedAt}`,
        `任务「${task.title}」停下等待输入（${input.waitingReason ?? '未知原因'}）。`,
      )
    }
  }

  async function runTurn(input: {
    threadId: string
    assistantMessageId: string
    request: SupervisorSendInput
    config: SupervisorConfig
    startedAt: number
  }): Promise<void> {
    const controller = new AbortController()
    controllers.set(input.threadId, controller)
    const timeout = setTimeout(() => controller.abort(), SUPERVISOR_POLICY.timeoutMs)
    let buffer = ''
    let flushTimer: NodeJS.Timeout | undefined
    const flush = () => {
      // 定时器已触发或这次是主动 flush：必须复位，否则后续 delta 不会再排队。
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = undefined
      }
      if (!buffer) return
      emit('supervisor.delta', input.assistantMessageId, {
        threadId: input.threadId,
        messageId: input.assistantMessageId,
        delta: buffer,
      })
      buffer = ''
    }
    const onDelta = (delta: string) => {
      buffer += delta
      if (buffer.length >= 512) {
        flush()
        return
      }
      if (!flushTimer) flushTimer = setTimeout(flush, 32)
    }

    try {
      const workspace = getWorkspace(deps.db, input.request.workspaceId)
      if (!workspace) {
        throw appError('workspace_not_found', 'workspace not found', {
          workspaceId: input.request.workspaceId,
        })
      }
      const canvas = getCanvasByWorkspace(deps.db, input.request.workspaceId)
      if (!canvas) {
        throw appError('canvas_not_found', 'canvas not found', {
          workspaceId: input.request.workspaceId,
        })
      }
      const nodes = listNodes(deps.db, canvas.id)
      const selectedIds = new Set(input.request.contextNodeIds)
      if (input.request.targetNodeId) selectedIds.add(input.request.targetNodeId)
      const selected = nodes.filter((node) => selectedIds.has(node.id))
      const agents = selected
        .filter((node) => node.type === 'agent')
        .map((node) => ({ id: node.id, title: nodeTitle(node), engine: node.data.engine }))
      const targetNodeId =
        input.request.targetNodeId &&
        agents.some((agent) => agent.id === input.request.targetNodeId)
          ? input.request.targetNodeId
          : agents.length === 1
            ? agents[0]?.id
            : undefined
      const contextNodeIds = selected
        .filter((node) => node.type !== 'agent' && node.type !== 'review')
        .map((node) => node.id)

      const toolContext: ToolContext = {
        workspaceId: input.request.workspaceId,
        threadId: input.threadId,
        triggerId: input.request.requestId,
        text: input.request.text,
        actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
        selection: { contextNodeIds, targetNodeId, agentCandidates: agents },
        policyVersion,
        promptVersion: PROMPT_VERSION,
        memo: {},
      }
      const bound = bindTools(tools, toolContext)
      const wrapped: BoundToolset = {
        list_canvas: wrapTool(
          'list_canvas',
          bound.list_canvas,
          input.assistantMessageId,
          input.threadId,
        ),
        list_tasks: wrapTool(
          'list_tasks',
          bound.list_tasks,
          input.assistantMessageId,
          input.threadId,
        ),
        get_task: wrapTool('get_task', bound.get_task, input.assistantMessageId, input.threadId),
        get_task_history: wrapTool(
          'get_task_history',
          bound.get_task_history,
          input.assistantMessageId,
          input.threadId,
        ),
        create_task: wrapTool(
          'create_task',
          bound.create_task,
          input.assistantMessageId,
          input.threadId,
        ),
        enqueue_task: wrapTool(
          'enqueue_task',
          bound.enqueue_task,
          input.assistantMessageId,
          input.threadId,
        ),
        retry_task: wrapTool(
          'retry_task',
          bound.retry_task,
          input.assistantMessageId,
          input.threadId,
        ),
        reopen_task: wrapTool(
          'reopen_task',
          bound.reopen_task,
          input.assistantMessageId,
          input.threadId,
        ),
        cancel_task: wrapTool(
          'cancel_task',
          bound.cancel_task,
          input.assistantMessageId,
          input.threadId,
        ),
        reply_task: wrapTool(
          'reply_task',
          bound.reply_task,
          input.assistantMessageId,
          input.threadId,
        ),
        create_tasks: wrapTool(
          'create_tasks',
          bound.create_tasks,
          input.assistantMessageId,
          input.threadId,
        ),
        handoff_task: wrapTool(
          'handoff_task',
          bound.handoff_task,
          input.assistantMessageId,
          input.threadId,
        ),
        create_text: wrapTool(
          'create_text',
          bound.create_text,
          input.assistantMessageId,
          input.threadId,
        ),
        create_agent: wrapTool(
          'create_agent',
          bound.create_agent,
          input.assistantMessageId,
          input.threadId,
        ),
        create_edge: wrapTool(
          'create_edge',
          bound.create_edge,
          input.assistantMessageId,
          input.threadId,
        ),
      }
      const history = trimHistory(store.listMessages(input.threadId, 21).messages.slice(-20))
      const engine = deps.engine ?? createAiSdkSupervisorEngine(input.config)
      const result = await engine.run({
        system: `${SUPERVISOR_PROMPT}\n\n${candidateCard({
          workspaceName: workspace.name,
          workspaceId: workspace.id,
          threadId: input.threadId,
          text: input.request.text,
          nodes: selected,
          canvasNodes: nodes,
          edgeCount: countEdges(deps.db, canvas.id),
          targetNodeId,
          policyVersion,
          defaultEngine: deps.defaultEngine,
        })}`,
        messages: history,
        tools: wrapped,
        signal: controller.signal,
        onDelta,
      })
      flush()
      let text = result.text.trim() || '（总管没有返回内容）'
      let reason = 'explicit request'
      const hasCreate = result.toolCalls.some(
        (call) =>
          (call.name === 'create_task' ||
            call.name === 'create_tasks' ||
            call.name === 'handoff_task') &&
          call.ok,
      )
      if (
        /已(批量)?(建|创建)|已经(批量)?(建|创建)|建好了|任务(已|已经)(建|创建)/.test(text) &&
        !hasCreate
      ) {
        text += '\n\n（我没有创建任务；请明确说要做什么，我再建任务。）'
        reason = 'claim_without_tool'
      }
      if (/已完成|已通过/.test(text) && !result.toolCalls.some((call) => call.ok)) {
        text += '\n\n（我没有工具结果证明完成；请以看板/任务详情状态为准。）'
        reason = 'claim_without_tool'
      }
      const hasAfterSales = result.toolCalls.some(
        (call) =>
          ['retry_task', 'reopen_task', 'cancel_task', 'reply_task'].includes(call.name) && call.ok,
      )
      if (/已(经)?(为你|帮你)?(重试|重开|取消|回复)/.test(text) && !hasAfterSales) {
        text += '\n\n（我没有对应的工具结果；请以任务详情/看板状态为准。）'
        reason = 'claim_without_tool'
      }
      const hasHandoff = result.toolCalls.some((call) => call.name === 'handoff_task' && call.ok)
      if (/已(经)?(为你|帮你)?(交接|生成交接节点)|已经把结果交给/.test(text) && !hasHandoff) {
        text += '\n\n（我没有对应的交接工具结果；请以画布节点/任务详情为准。）'
        reason = 'claim_without_tool'
      }
      const handoffCard = result.toolCalls
        .filter((call) => call.name === 'handoff_task' && call.ok)
        .map((call) => (call.result as { task?: unknown } | undefined)?.task)
        .map((item) => SupervisorTaskCard.safeParse(item))
        .find((parsed) => parsed.success)
      const card =
        result.toolCalls
          .filter((call) => call.name === 'create_task' && call.ok)
          .map((call) => SupervisorTaskCard.safeParse(call.result))
          .find((parsed) => parsed.success) ?? handoffCard
      const kind = hasCreate
        ? 'create_task'
        : result.toolCalls.some(
              (call) =>
                call.name === 'list_tasks' ||
                call.name === 'get_task' ||
                call.name === 'get_task_history' ||
                call.name === 'list_canvas',
            )
          ? 'query_status'
          : 'chat'
      const turn = store.insertAssistantTurn({
        threadId: input.threadId,
        triggerId: input.request.requestId,
        messageId: input.assistantMessageId,
        content: text,
        toolCalls: result.toolCalls,
        status: 'ok',
        error: null,
        decision: {
          kind,
          strength: 'explicit',
          mode: 'explicit',
          reason,
          taskId: card?.success ? card.data.taskId : null,
        },
      })
      emit('supervisor.message', turn.message.id, turn.message)
    } catch (error) {
      // 模型/网关错误必须把原因带到 UI；toAppError 的兜底文案会把诊断信息吞掉。
      const failure = isAppError(error)
        ? error
        : appError(
            'supervisor_model_error',
            error instanceof Error ? error.message : 'unexpected error',
          )
      try {
        const turn = store.insertAssistantTurn({
          threadId: input.threadId,
          triggerId: input.request.requestId,
          messageId: input.assistantMessageId,
          content: `总管执行失败：${failure.message}`,
          toolCalls: [],
          status: 'error',
          error: failure,
          decision: {
            kind: 'error',
            strength: 'explicit',
            mode: 'explicit',
            reason: failure.code,
            taskId: null,
          },
        })
        emit('supervisor.message', turn.message.id, turn.message)
      } catch {
        // 持久化失败时至少让 UI 知道本轮失败。
        emit('supervisor.message', input.assistantMessageId, {
          id: input.assistantMessageId,
          threadId: input.threadId,
          role: 'assistant',
          content: `总管执行失败：${failure.message}`,
          toolCalls: [],
          decision: null,
          meta: null,
          status: 'error',
          error: failure,
          createdAt: deps.now(),
        } satisfies SupervisorMessage)
      }
      deps.logger?.error(
        {
          event: 'supervisor.model_error',
          threadId: input.threadId,
          triggerId: input.request.requestId,
          code: failure.code,
          message: failure.message,
          durationMs: deps.now() - input.startedAt,
        },
        'supervisor turn failed',
      )
    } finally {
      if (flushTimer) clearTimeout(flushTimer)
      clearTimeout(timeout)
      controllers.delete(input.threadId)
      active.delete(input.threadId)
      if (active.size === 0) {
        for (const resolve of idleWaiters.splice(0)) resolve()
      }
    }
  }

  return {
    policyVersion,

    /** runtime 在 task 状态转移提交后调用；只做通知与验收员派发，不改任务状态。 */
    observeTask,

    /** target 离开 review 时由 runtime 调用，取消这一轮仍在运行的验收员。 */
    cancelVerifiersForTarget,

    send(input: SupervisorSendInput): SupervisorSendResult {
      const loaded = loadSupervisorConfig(deps.dataDir)
      if (!loaded.ok) {
        return { ok: false, error: appError(loaded.code, loaded.message) }
      }
      const thread = store.getOrCreateThread(input.workspaceId)
      const existing = store.getUserMessageByTrigger(thread.id, input.requestId)
      if (existing) {
        return { ok: true, ack: { threadId: thread.id, messageId: existing.id } }
      }
      if (active.has(thread.id)) {
        return { ok: false, error: appError('supervisor_busy', 'supervisor is busy') }
      }
      const inserted = store.insertUserMessage({
        threadId: thread.id,
        triggerId: input.requestId,
        text: input.text,
        meta: {
          contextNodeIds: input.contextNodeIds,
          targetNodeId: input.targetNodeId ?? null,
        },
      })
      active.add(thread.id)
      const assistantMessageId = deps.newId()
      const run = runTurn({
        threadId: thread.id,
        assistantMessageId,
        request: input,
        config: loaded.config,
        startedAt: deps.now(),
      })
      track(() => run)
      return { ok: true, ack: { threadId: thread.id, messageId: inserted.message.id } }
    },

    history(workspaceId: string, limit: number, before?: string): SupervisorMessagesResponse {
      const thread = store.findLatestThread(workspaceId)
      if (!thread) return { threadId: null, messages: [] }
      const page = store.listMessages(thread.id, limit, before)
      return {
        threadId: thread.id,
        messages: page.messages,
        ...(page.nextBefore ? { nextBefore: page.nextBefore } : {}),
      }
    },

    status(): SupervisorStatusResponse {
      const loaded = loadSupervisorConfig(deps.dataDir)
      return loaded.ok
        ? {
            configured: true,
            model: loaded.config.model,
            mode: SUPERVISOR_POLICY.mode,
            policyVersion,
          }
        : {
            configured: false,
            mode: SUPERVISOR_POLICY.mode,
            policyVersion,
            errorCode: loaded.code,
          }
    },

    waitForIdle(): Promise<void> {
      if (active.size === 0) return Promise.resolve()
      return new Promise((resolve) => idleWaiters.push(resolve))
    },

    close(): void {
      for (const controller of controllers.values()) controller.abort()
      for (const controller of polishControllers) controller.abort()
    },
  }
}

export type SupervisorService = ReturnType<typeof createSupervisorService>
