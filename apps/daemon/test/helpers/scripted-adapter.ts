import {
  APPROVAL_REQUEST_EVENT,
  EventSchemas,
  EventType,
  SESSION_OUTCOME_EVENT,
  SESSION_USAGE_EVENT,
  VERIFIER_PROMPT_MARKER,
  type AgentAdapter,
  type AgentEvent,
  type AgentRun,
  type ApprovalDecision,
  type ApprovalRequest,
  type StartInput,
} from '@baton/protocol'

export { VERIFIER_PROMPT_MARKER }

export type ScriptStep =
  | { kind: 'text'; text: string }
  | { kind: 'approval'; request: ApprovalRequest }
  | { kind: 'pause'; outcome: 'blocked' | 'dropped'; reason?: string }
  | { kind: 'usage'; costUsd?: number; turns?: number }
  | { kind: 'finish'; outcome?: 'ready' | 'unreported' }
  | { kind: 'error'; message: string }

interface ScriptedOptions {
  script?: ScriptStep[]
  /** prompt 含 VERIFIER_PROMPT_MARKER 时使用的脚本（测试验收员链路）。 */
  verifierScript?: ScriptStep[]
  threadId?: string
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const DEFAULT_SCRIPT: ScriptStep[] = [
  { kind: 'text', text: 'scripted: working' },
  {
    kind: 'approval',
    request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' },
  },
  { kind: 'text', text: 'scripted: approved' },
  { kind: 'finish' },
]

function event(value: unknown): AgentEvent {
  return EventSchemas.parse(value)
}

/**
 * 脚本化适配器：只产生 AG-UI 事件并接受控制调用，不读 DB、不发 WS、不使用定时器。
 * 用于 M1-5 的确定性集成测试；真实引擎接入见 M1-7。
 *
 * 生命周期约定：
 * - interrupt/dispose 后不再产生事件，send/approve 抛错；
 * - RUN_FINISHED/RUN_ERROR 一旦产出，send/approve 也视为关闭；
 * - approve 必须匹配当前 pending 的 requestId，避免串审批。
 */
export class ScriptedAdapter implements AgentAdapter {
  readonly name = 'claude-sdk' as const
  private readonly script: ScriptStep[]
  private readonly verifierScript?: ScriptStep[]
  private readonly threadId: string

  constructor(options: ScriptedOptions = {}) {
    this.script = options.script ?? DEFAULT_SCRIPT
    this.verifierScript = options.verifierScript
    this.threadId = options.threadId ?? 'scripted-thread'
  }

  async start(input: StartInput): Promise<AgentRun> {
    const threadId = this.threadId
    const script =
      this.verifierScript && input.prompt.includes(VERIFIER_PROMPT_MARKER)
        ? this.verifierScript
        : this.script
    const runId = 'scripted-run'
    const queue: string[] = []
    let pending: { requestId: string; deferred: Deferred<ApprovalDecision> } | null = null
    let pauseWait: Deferred<string> | null = null
    let interrupted = false
    let closed = false
    let finished = false
    let messageSeq = 0
    let approvalSeq = 0

    const isClosed = (): boolean => closed || finished

    const text = function* (delta: string): Generator<AgentEvent> {
      if (isClosed() || interrupted) {
        return
      }
      const messageId = `scripted-msg-${++messageSeq}`
      yield event({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: 'assistant',
      })
      if (isClosed() || interrupted) {
        return
      }
      yield event({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta })
      if (isClosed() || interrupted) {
        return
      }
      yield event({ type: EventType.TEXT_MESSAGE_END, messageId })
    }

    const drain = function* (): Generator<AgentEvent> {
      while (queue.length > 0) {
        yield* text(queue.shift()!)
      }
    }

    const events = (async function* (): AsyncGenerator<AgentEvent> {
      try {
        if (isClosed() || interrupted) {
          return
        }
        yield event({ type: EventType.RUN_STARTED, threadId, runId })

        for (const step of script) {
          if (isClosed() || interrupted) {
            return
          }
          yield* drain()

          if (step.kind === 'text') {
            yield* text(step.text)
          } else if (step.kind === 'approval') {
            approvalSeq += 1
            const requestId = `req-${approvalSeq}`
            const wait = deferred<ApprovalDecision>()
            pending = { requestId, deferred: wait }
            yield event({
              type: EventType.CUSTOM,
              name: APPROVAL_REQUEST_EVENT,
              value: { requestId, request: step.request },
            })

            if (isClosed() || interrupted) {
              return
            }
            const decision = await wait.promise
            if (pending?.requestId === requestId) {
              pending = null
            }
            if (isClosed() || interrupted) {
              return
            }
            if (decision === 'deny') {
              yield* text('scripted: denied')
              if (isClosed() || interrupted) {
                return
              }
              yield event({
                type: EventType.CUSTOM,
                name: SESSION_OUTCOME_EVENT,
                value: { outcome: 'ready' },
              })
              finished = true
              yield event({ type: EventType.RUN_FINISHED, threadId, runId })
              return
            }
          } else if (step.kind === 'pause') {
            yield event({
              type: EventType.CUSTOM,
              name: SESSION_OUTCOME_EVENT,
              value: {
                outcome: step.outcome,
                ...(step.reason ? { reason: step.reason } : {}),
              },
            })
            const wait = deferred<string>()
            pauseWait = wait
            const reply = await wait.promise
            pauseWait = null
            if (isClosed() || interrupted) {
              return
            }
            yield* text(`scripted: resumed: ${reply}`)
          } else if (step.kind === 'usage') {
            yield event({
              type: EventType.CUSTOM,
              name: SESSION_USAGE_EVENT,
              value: {
                ...(step.costUsd !== undefined ? { costUsd: step.costUsd } : {}),
                ...(step.turns !== undefined ? { turns: step.turns } : {}),
              },
            })
          } else if (step.kind === 'error') {
            finished = true
            yield event({ type: EventType.RUN_ERROR, message: step.message })
            return
          } else if (step.kind === 'finish') {
            if (step.outcome === 'unreported') {
              return
            }
            yield event({
              type: EventType.CUSTOM,
              name: SESSION_OUTCOME_EVENT,
              value: { outcome: 'ready' },
            })
            break
          }
        }

        if (isClosed() || interrupted) {
          return
        }
        yield* drain()
        if (isClosed() || interrupted) {
          return
        }
        finished = true
        yield event({ type: EventType.RUN_FINISHED, threadId, runId })
      } finally {
        closed = true
        pending?.deferred.resolve('deny')
        pending = null
        pauseWait?.resolve('')
        pauseWait = null
      }
    })()

    return {
      events,
      approve: async (requestId, decision) => {
        if (isClosed()) {
          throw new Error('scripted adapter run is closed')
        }
        const current = pending
        if (!current || current.requestId !== requestId) {
          throw new Error(`no pending approval ${requestId}`)
        }
        pending = null
        current.deferred.resolve(decision)
      },
      answerQuestion: async () => {
        throw new Error('scripted adapter does not ask structured questions')
      },
      send: async (delta) => {
        if (isClosed()) {
          throw new Error('scripted adapter run is closed')
        }
        if (pauseWait) {
          const wait = pauseWait
          pauseWait = null
          wait.resolve(delta)
          return
        }
        queue.push(delta)
      },
      interrupt: async () => {
        interrupted = true
        closed = true
        pending?.deferred.resolve('deny')
        pending = null
        pauseWait?.resolve('')
        pauseWait = null
      },
      dispose: async () => {
        interrupted = true
        closed = true
        pending?.deferred.resolve('deny')
        pending = null
        pauseWait?.resolve('')
        pauseWait = null
      },
    }
  }
}
