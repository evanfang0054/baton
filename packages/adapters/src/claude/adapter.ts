import type {
  AgentAdapter,
  AgentEvent,
  AgentRun,
  ApprovalDecision,
  StartInput,
} from '@baton/protocol'
import { randomUUID } from 'node:crypto'
import {
  mapApprovalRequest,
  mapRunError,
  mapRunFinished,
  mapRunStarted,
  mapSessionOutcome,
  mapSessionUsage,
  mapText,
  mapToolResult,
  mapToolUse,
} from './mapping.js'
import { BATON_PROTOCOL_PROMPT } from './outcome.js'
import { createSdkClaudeTransport, type ClaudeTransportFactory } from './transport.js'

export interface ClaudeAdapterOptions {
  transportFactory?: ClaudeTransportFactory
  maxTurns?: number
  /** 全局 kill switch；false 时即使 workspace 打开 hooks 也不加载。 */
  projectHooksGlobal?: boolean
}

/**
 * 真实 Claude 适配器：只消费窄 transport，不直接依赖 SDK 类型。
 * 事件流按完整 block 映射；blocked/dropped 后保持打开等待 send。
 */
export class ClaudeAdapter implements AgentAdapter {
  readonly name = 'claude-sdk' as const
  private readonly factory: ClaudeTransportFactory
  private readonly maxTurns: number
  private readonly projectHooksGlobal: boolean

  constructor(options: ClaudeAdapterOptions = {}) {
    this.factory = options.transportFactory ?? createSdkClaudeTransport
    this.maxTurns = options.maxTurns ?? 30
    this.projectHooksGlobal = options.projectHooksGlobal ?? true
  }

  async start(input: StartInput): Promise<AgentRun> {
    const transport = await this.factory({
      prompt: input.prompt,
      cwd: input.cwd,
      workspaceTrust: input.workspaceTrust,
      projectHooksGlobal: this.projectHooksGlobal,
      bypassPermissions: input.bypassPermissions,
      systemPromptAppend: BATON_PROTOCOL_PROMPT,
      maxTurns: this.maxTurns,
    })

    const runId = randomUUID()
    let closed = false
    let messageSeq = 0
    const nextMessageId = (): string => `claude-msg-${++messageSeq}`

    async function* events(): AsyncGenerator<AgentEvent> {
      let started = false
      let finished = false
      let runFinished = false
      let readyTimer: ReturnType<typeof setTimeout> | null = null
      let threadId = 'claude-session'
      let outcome: 'ready' | 'blocked' | 'dropped' | null = null

      const clearReadyTimer = (): void => {
        if (readyTimer) {
          clearTimeout(readyTimer)
          readyTimer = null
        }
      }

      try {
        for await (const event of transport.events) {
          if (event.type === 'init') {
            threadId = event.sessionId
            if (!started) {
              started = true
              yield mapRunStarted(threadId, runId)
            }
            continue
          }
          if (!started) {
            started = true
            yield mapRunStarted(threadId, runId)
          }

          if (event.type === 'text') {
            for (const mapped of mapText(event.text, nextMessageId())) {
              yield mapped
            }
          } else if (event.type === 'tool_use') {
            for (const mapped of mapToolUse(event.id, event.name, event.input)) {
              yield mapped
            }
          } else if (event.type === 'tool_result') {
            yield mapToolResult(nextMessageId(), event.toolUseId, event.content)
          } else if (event.type === 'approval_request') {
            yield mapApprovalRequest(event.requestId, event.request)
          } else if (event.type === 'outcome') {
            outcome = event.outcome
            yield mapSessionOutcome(event.outcome, event.reason)
            if (event.outcome === 'ready') {
              // ready 是会话级终态，但 SDK 的 result（含 usage）可能紧随其后；
              // 留住事件流一个短窗口，拿不到 result 时主动关闭，避免 resumed turn 挂死。
              finished = true
              readyTimer = setTimeout(() => {
                void transport.dispose().catch(() => {})
              }, 1_000)
            }
          } else if (event.type === 'turn_result') {
            if (!event.ok) {
              clearReadyTimer()
              if (finished) {
                runFinished = true
                yield mapRunFinished(threadId, runId)
                return
              }
              finished = true
              yield mapRunError(event.error ?? 'claude turn failed')
              return
            }
            if (event.costUsd !== undefined || event.turns !== undefined) {
              yield mapSessionUsage(event.costUsd, event.turns)
            }
            if (outcome === 'ready') {
              clearReadyTimer()
              finished = true
              runFinished = true
              yield mapRunFinished(threadId, runId)
              return
            }
            // 未上报 outcome 时，turn 结束即 session 结束；daemon 合成 unreported。
            if (outcome === null) {
              clearReadyTimer()
              finished = true
              runFinished = true
              yield mapRunFinished(threadId, runId)
              return
            }
            // blocked/dropped：保持事件流打开，等待 send。
          } else if (event.type === 'error') {
            clearReadyTimer()
            if (finished) {
              runFinished = true
              yield mapRunFinished(threadId, runId)
              return
            }
            finished = true
            yield mapRunError(event.message)
            return
          }
        }

        if (!runFinished && (finished || outcome === 'ready' || outcome === null)) {
          runFinished = true
          yield mapRunFinished(threadId, runId)
        }
      } finally {
        clearReadyTimer()
        closed = true
        await transport.dispose().catch(() => {})
      }
    }

    return {
      events: events(),
      approve: async (requestId: string, decision: ApprovalDecision, note?: string) => {
        if (closed) {
          throw new Error('session_closed')
        }
        await transport.approve(requestId, decision, note)
      },
      answerQuestion: async (
        requestId: string,
        answers: Record<string, string>,
        response?: string,
      ) => {
        if (closed) {
          throw new Error('session_closed')
        }
        await transport.answerQuestion(requestId, answers, response)
      },
      send: async (text: string) => {
        if (closed) {
          throw new Error('session_closed')
        }
        await transport.send(text)
      },
      interrupt: async () => {
        if (closed) {
          return
        }
        await transport.interrupt()
      },
      dispose: async () => {
        closed = true
        await transport.dispose()
      },
    }
  }
}
