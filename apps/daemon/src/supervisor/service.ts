import { SUPERVISOR_POLICY, supervisorPolicyVersion } from '@baton/core'
import {
  SupervisorTaskCard,
  type AppError,
  type Engine as EngineValue,
  type Node,
  type SupervisorMessage,
  type SupervisorMessagesResponse,
  type SupervisorSendInput,
  type SupervisorStatusResponse,
} from '@baton/protocol'
import { getCanvasByWorkspace, getWorkspace, listNodes } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError, isAppError } from '../errors.js'
import type { Logger } from '../log.js'
import type { TaskService } from '../runtime/task-service.js'
import { loadSupervisorConfig, type SupervisorConfig } from './config.js'
import { createAiSdkSupervisorEngine, type SupervisorEngine } from './engine.js'
import { PROMPT_VERSION, SUPERVISOR_PROMPT } from './prompt.js'
import { createSupervisorStore } from './store.js'
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
  engine?: SupervisorEngine
  now: () => number
  newId: () => string
  logger?: Logger
  broadcastRaw?: (frame: string) => void
  track?: (action: () => void | Promise<void>) => void
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function nodeTitle(node: Node): string {
  switch (node.type) {
    case 'text':
      return (
        node.data.content
          .split('\n')
          .find((line) => line.trim())
          ?.trim()
          .slice(0, 60) ?? 'text'
      )
    case 'file':
      return node.data.name
    case 'image':
      return node.data.alt ?? 'image'
    case 'agent':
      return node.data.title
    case 'group':
      return node.data.label
    case 'review':
      return 'review'
  }
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
    taskService: deps.taskService,
    now: deps.now,
    newId: deps.newId,
    defaultEngine: deps.defaultEngine,
    enqueueTask: deps.enqueueTask,
  })
  const policyVersion = supervisorPolicyVersion(SUPERVISOR_POLICY, PROMPT_VERSION)
  const active = new Set<string>()
  const controllers = new Map<string, AbortController>()
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
        list_tasks: wrapTool(
          'list_tasks',
          bound.list_tasks,
          input.assistantMessageId,
          input.threadId,
        ),
        get_task: wrapTool('get_task', bound.get_task, input.assistantMessageId, input.threadId),
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
      const hasCreate = result.toolCalls.some((call) => call.name === 'create_task' && call.ok)
      if (/已(建|创建)|建好了|任务.*(创建|建好)/.test(text) && !hasCreate) {
        text += '\n\n（我没有创建任务；请明确说要做什么，我再建任务。）'
        reason = 'claim_without_tool'
      }
      if (/已完成|已通过/.test(text) && !result.toolCalls.some((call) => call.ok)) {
        text += '\n\n（我没有工具结果证明完成；请以看板/任务详情状态为准。）'
        reason = 'claim_without_tool'
      }
      const card = result.toolCalls
        .filter((call) => call.name === 'create_task' && call.ok)
        .map((call) => SupervisorTaskCard.safeParse(call.result))
        .find((parsed) => parsed.success)
      const kind = hasCreate
        ? 'create_task'
        : result.toolCalls.some((call) => call.name === 'list_tasks' || call.name === 'get_task')
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
    },
  }
}

export type SupervisorService = ReturnType<typeof createSupervisorService>
