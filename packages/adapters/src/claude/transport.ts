import {
  createSdkMcpServer,
  query,
  tool,
  type CanUseTool,
  type Options,
  type PermissionResult,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  ApprovalDecision,
  ApprovalRequest,
  RiskLevel,
  WorkspaceTrustSnapshot,
} from '@baton/protocol'
import { z } from 'zod'

export const BATON_REPORT_TOOL = 'mcp__baton__baton_report'

/** v1 明确禁用的工具面；策略 deny 仍会再兜底一次。 */
export const DISALLOWED_TOOLS = [
  'EnterWorktree',
  'ExitWorktree',
  'CronCreate',
  'CronDelete',
  'CronList',
  'ScheduleWakeup',
  'PushNotification',
  'RemoteTrigger',
  'Workflow',
  'Monitor',
  'Projects',
  'Artifact',
  'ClaudeDesign',
] as const

export interface ClaudeTransportInput {
  prompt: string
  cwd: string
  workspaceTrust: WorkspaceTrustSnapshot
  projectHooksGlobal: boolean
  bypassPermissions: boolean
  systemPromptAppend: string
  maxTurns: number
  maxBudgetUsd: number
}

export type ClaudeEvent =
  | { type: 'init'; sessionId: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { type: 'approval_request'; requestId: string; request: ApprovalRequest }
  | { type: 'outcome'; outcome: 'ready' | 'blocked' | 'dropped'; reason?: string }
  | { type: 'turn_result'; ok: boolean; costUsd?: number; turns?: number; error?: string }
  | { type: 'error'; message: string }

export interface ClaudeTransport {
  events: AsyncIterable<ClaudeEvent>
  send(text: string): Promise<void>
  approve(requestId: string, decision: ApprovalDecision, note?: string): Promise<void>
  answerQuestion(
    requestId: string,
    answers: Record<string, string>,
    response?: string,
  ): Promise<void>
  interrupt(): Promise<void>
  dispose(): Promise<void>
}

export type ClaudeTransportFactory = (input: ClaudeTransportInput) => Promise<ClaudeTransport>

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(value: T): void {
    if (this.closed) {
      return
    }
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value, done: false })
    } else {
      this.values.push(value)
    }
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift()
        if (value !== undefined) {
          return Promise.resolve({ value, done: false })
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true })
        }
        return new Promise((resolve) => this.waiters.push(resolve))
      },
    }
  }
}

function sdkEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value
    }
  }
  // 让服务端能区分 baton 发起的会话；不覆盖用户的 CLAUDE_CONFIG_DIR。
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'baton/0.0.0'
  return env
}

export function buildClaudeOptions(input: ClaudeTransportInput): Options {
  const hooksEnabled = input.workspaceTrust.projectHooks && input.projectHooksGlobal
  return {
    cwd: input.cwd,
    // user settings 承载本机登录态；隔离 project/local 即可，清空 user 会导致 OAuth 不可用（ADR 0004）。
    settingSources: input.workspaceTrust.projectSettings ? ['user', 'project'] : ['user'],
    strictMcpConfig: !input.workspaceTrust.projectSettings,
    plugins: [],
    permissionMode: input.bypassPermissions ? 'bypassPermissions' : 'default',
    allowDangerouslySkipPermissions: input.bypassPermissions,
    includePartialMessages: false,
    maxTurns: input.maxTurns,
    maxBudgetUsd: input.maxBudgetUsd,
    disallowedTools: [...DISALLOWED_TOOLS],
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: input.systemPromptAppend,
    },
    managedSettings: {
      allowManagedPermissionRulesOnly: true,
      ...(hooksEnabled ? {} : { disableAllHooks: true }),
      permissions: {
        // 跳过审批模式下必须移除这一项，否则 SDK 会拒绝 bypassPermissions。
        ...(input.bypassPermissions ? {} : { disableBypassPermissionsMode: 'disable' as const }),
        blockReadsOutsideWorkingDirectories: true,
        blockWritesOutsideWorkingDirectories: true,
      },
    },
    env: sdkEnv(),
  }
}

function riskForTool(toolName: string): RiskLevel {
  if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob') {
    return 'low'
  }
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit') {
    return 'medium'
  }
  return 'high'
}

const PATH_TOOLS = new Set(['Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit'])

/**
 * 引擎的文件工具只带绝对 file_path，不带 cwd；策略无法判定工作区边界时会把
 * Edit/Write 判成 high，导致 autopilot 永远不能自动批准。这里只给审批上下文补
 * cwd，真正回传给 SDK 的 updatedInput 仍是原始入参。
 */
export function approvalInputWithCwd(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string,
): Record<string, unknown> {
  if (!PATH_TOOLS.has(toolName)) return toolInput
  if (typeof toolInput.cwd === 'string') return toolInput
  return { ...toolInput, cwd }
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'object' && block !== null && 'text' in block) {
          return String((block as { text: unknown }).text)
        }
        return JSON.stringify(block)
      })
      .join('\n')
  }
  return JSON.stringify(content)
}

function translateSdkMessage(message: SDKMessage): ClaudeEvent[] {
  if (message.type === 'system' && message.subtype === 'init') {
    return [{ type: 'init', sessionId: message.session_id }]
  }
  if (message.type === 'assistant') {
    const events: ClaudeEvent[] = []
    const content = message.message.content
    if (typeof content === 'string') {
      return [{ type: 'text', text: content }]
    }
    for (const block of content) {
      if (block.type === 'text') {
        events.push({ type: 'text', text: block.text })
      } else if (block.type === 'tool_use') {
        events.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
      }
    }
    return events
  }
  if (message.type === 'user') {
    const content = message.message.content
    if (typeof content === 'string') {
      return []
    }
    const events: ClaudeEvent[] = []
    for (const block of content) {
      if (typeof block === 'object' && block !== null && block.type === 'tool_result') {
        events.push({
          type: 'tool_result',
          toolUseId: block.tool_use_id,
          content: toolResultText(block.content),
          isError: block.is_error === true,
        })
      }
    }
    return events
  }
  if (message.type === 'result') {
    const failed = message.subtype !== 'success' || message.is_error
    if (failed) {
      const detail =
        message.subtype === 'success'
          ? 'claude turn failed'
          : message.errors.join('; ') || message.subtype
      return [{ type: 'turn_result', ok: false, error: detail }]
    }
    return [
      {
        type: 'turn_result',
        ok: true,
        costUsd: message.total_cost_usd,
        turns: message.num_turns,
      },
    ]
  }
  return []
}

/**
 * 真实 SDK transport：SDK 类型只在本文件出现。
 * 审批、outcome 与流式输入都收敛到窄接口，adapter/daemon 不感知 SDK。
 */
export const createSdkClaudeTransport: ClaudeTransportFactory = async (input) => {
  const events = new AsyncQueue<ClaudeEvent>()
  const inputQueue = new AsyncQueue<SDKUserMessage>()
  const pending = new Map<
    string,
    { input: Record<string, unknown>; resolve: (result: PermissionResult) => void }
  >()
  let requestSeq = 0
  let reported = false
  let closed = false

  inputQueue.push({
    type: 'user',
    message: { role: 'user', content: input.prompt },
    parent_tool_use_id: null,
  })

  const canUseTool: CanUseTool = (toolName, toolInput, options) => {
    if (toolName === BATON_REPORT_TOOL && options.mcpServer?.source === 'sdk') {
      return Promise.resolve({ behavior: 'allow', updatedInput: toolInput })
    }
    const requestId = `claude-${++requestSeq}`
    return new Promise<PermissionResult>((resolve) => {
      const finish = (result: PermissionResult): void => {
        if (pending.delete(requestId)) {
          resolve(result)
        }
      }
      pending.set(requestId, { input: toolInput, resolve: finish })
      options.signal.addEventListener(
        'abort',
        () => finish({ behavior: 'deny', message: 'approval aborted' }),
        { once: true },
      )
      events.push({
        type: 'approval_request',
        requestId,
        request: {
          toolName,
          input: approvalInputWithCwd(toolName, toolInput, input.cwd),
          risk: riskForTool(toolName),
        },
      })
    })
  }

  const reportServer = createSdkMcpServer({
    name: 'baton',
    version: '0.0.0',
    tools: [
      // SDK 的 zod v3/v4 双类型在 pnpm 隔离下结构不兼容；运行时仍是标准 JSON Schema。
      tool(
        'baton_report',
        'Report the final state of this turn to baton before ending the turn.',
        {
          outcome: z.enum(['ready', 'blocked', 'dropped']),
          reason: z.string().optional(),
        } as never,
        (async (args: { outcome: 'ready' | 'blocked' | 'dropped'; reason?: string }) => {
          if (!reported) {
            reported = true
            events.push({
              type: 'outcome',
              outcome: args.outcome,
              ...(args.reason ? { reason: args.reason } : {}),
            })
          }
          return { content: [{ type: 'text' as const, text: 'reported' }] }
        }) as never,
      ) as never,
    ],
  })

  const sdkQuery = query({
    prompt: inputQueue,
    options: {
      ...buildClaudeOptions(input),
      canUseTool,
      mcpServers: { baton: reportServer },
    },
  })

  const drain = (async () => {
    try {
      for await (const message of sdkQuery) {
        for (const event of translateSdkMessage(message)) {
          events.push(event)
        }
      }
    } catch (error) {
      events.push({
        type: 'error',
        message: error instanceof Error ? error.message : 'claude sdk failed',
      })
    } finally {
      closed = true
      inputQueue.close()
      for (const entry of pending.values()) {
        entry.resolve({ behavior: 'deny', message: 'session closed' })
      }
      pending.clear()
      events.close()
    }
  })()

  return {
    events,
    send: async (text) => {
      if (closed) {
        throw new Error('session_closed')
      }
      inputQueue.push({
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null,
      })
    },
    approve: async (requestId, decision, note) => {
      const entry = pending.get(requestId)
      if (!entry) {
        return
      }
      // resolve() 内部会 delete；这里提前 delete 会让 finish() 认为请求已失效，SDK 将永远挂起。
      entry.resolve(
        decision === 'allow'
          ? { behavior: 'allow', updatedInput: entry.input }
          : { behavior: 'deny', message: note ?? 'denied by user' },
      )
    },
    answerQuestion: async (requestId, answers, response) => {
      const entry = pending.get(requestId)
      if (!entry) {
        return
      }
      entry.resolve({
        behavior: 'allow',
        updatedInput: {
          ...entry.input,
          answers,
          ...(response ? { response } : {}),
        },
      })
    },
    interrupt: async () => {
      for (const entry of pending.values()) {
        entry.resolve({ behavior: 'deny', message: 'interrupted' })
      }
      pending.clear()
      if (!closed) {
        await sdkQuery.interrupt()
      }
    },
    dispose: async () => {
      inputQueue.close()
      // 先给 SDK 优雅退出窗口；超时再强制关闭，避免孤儿进程。
      await Promise.race([drain, new Promise<void>((resolve) => setTimeout(resolve, 10_000))])
      if (!closed) {
        sdkQuery.close()
      }
      await drain.catch(() => {})
      closed = true
    },
  }
}
