import {
  EventSchemas,
  type AgentAdapter,
  type AgentEvent,
  type AgentRun,
  type ApprovalRequest,
  type StartInput,
} from '@baton/protocol'

export type FakeStep =
  | { kind: 'text'; text: string }
  | { kind: 'approval'; request: ApprovalRequest }
  | { kind: 'finish' }
  | { kind: 'error'; message: string }

interface FakeOptions {
  script?: FakeStep[]
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

const DEFAULT_SCRIPT: FakeStep[] = [
  { kind: 'text', text: 'fake: working' },
  {
    kind: 'approval',
    request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' },
  },
  { kind: 'text', text: 'fake: approved' },
  { kind: 'finish' },
]

function event(value: unknown): AgentEvent {
  return EventSchemas.parse(value)
}

/**
 * 脚本化适配器：只产生 AG-UI 事件并接受控制调用，不读 DB、不发 WS、不使用定时器。
 * 用于 M1-5 的确定性集成测试；真实引擎接入见 M1-7。
 */
export class FakeAdapter implements AgentAdapter {
  readonly name = 'fake' as const
  private readonly script: FakeStep[]
  private readonly threadId: string

  constructor(options: FakeOptions = {}) {
    this.script = options.script ?? DEFAULT_SCRIPT
    this.threadId = options.threadId ?? 'fake-thread'
  }

  async start(_input: StartInput): Promise<AgentRun> {
    const threadId = this.threadId
    const script = this.script
    const runId = 'fake-run'
    const queue: string[] = []
    let pending: Deferred<'allow' | 'deny'> | null = null
    let interrupted = false
    let messageSeq = 0
    let approvalSeq = 0

    const text = function* (delta: string): Generator<AgentEvent> {
      const messageId = `fake-msg-${++messageSeq}`
      yield event({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' })
      yield event({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta })
      yield event({ type: 'TEXT_MESSAGE_END', messageId })
    }

    const drain = function* (): Generator<AgentEvent> {
      while (queue.length > 0) {
        yield* text(queue.shift()!)
      }
    }

    const events = (async function* (): AsyncGenerator<AgentEvent> {
      yield event({ type: 'RUN_STARTED', threadId, runId })

      for (const step of script) {
        if (interrupted) return
        yield* drain()

        if (step.kind === 'text') {
          yield* text(step.text)
        } else if (step.kind === 'approval') {
          approvalSeq += 1
          const wait = deferred<'allow' | 'deny'>()
          pending = wait
          yield event({
            type: 'CUSTOM',
            name: 'approval.request',
            value: { requestId: `req-${approvalSeq}`, request: step.request },
          })
          const decision = await wait.promise
          pending = null
          if (interrupted) return
          if (decision === 'deny') {
            yield* text('fake: denied')
            yield event({ type: 'RUN_FINISHED', threadId, runId })
            return
          }
        } else if (step.kind === 'error') {
          yield event({ type: 'RUN_ERROR', message: step.message })
          return
        }
      }

      if (interrupted) return
      yield* drain()
      yield event({ type: 'RUN_FINISHED', threadId, runId })
    })()

    return {
      events,
      approve: async (_requestId, decision) => {
        pending?.resolve(decision)
      },
      send: async (delta) => {
        queue.push(delta)
      },
      interrupt: async () => {
        interrupted = true
        pending?.resolve('deny')
        pending = null
      },
      dispose: async () => {
        interrupted = true
        pending?.resolve('deny')
        pending = null
      },
    }
  }
}
