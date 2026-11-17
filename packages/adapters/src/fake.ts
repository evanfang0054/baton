import {
  EventSchemas,
  EventType,
  type AgentAdapter,
  type AgentEvent,
  type AgentRun,
  type ApprovalDecision,
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

const APPROVAL_REQUEST = 'approval.request'

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
    let pending: { requestId: string; deferred: Deferred<ApprovalDecision> } | null = null
    let interrupted = false
    let closed = false
    let messageSeq = 0
    let approvalSeq = 0

    const text = function* (delta: string): Generator<AgentEvent> {
      const messageId = `fake-msg-${++messageSeq}`
      yield event({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: 'assistant',
      })
      yield event({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta })
      yield event({ type: EventType.TEXT_MESSAGE_END, messageId })
    }

    const drain = function* (): Generator<AgentEvent> {
      while (queue.length > 0) {
        yield* text(queue.shift()!)
      }
    }

    const events = (async function* (): AsyncGenerator<AgentEvent> {
      try {
        yield event({ type: EventType.RUN_STARTED, threadId, runId })

        for (const step of script) {
          if (interrupted) return
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
              name: APPROVAL_REQUEST,
              value: { requestId, request: step.request },
            })

            const decision = await wait.promise
            if (pending?.requestId === requestId) pending = null
            if (interrupted) return
            if (decision === 'deny') {
              yield* text('fake: denied')
              yield event({ type: EventType.RUN_FINISHED, threadId, runId })
              return
            }
          } else if (step.kind === 'error') {
            yield event({ type: EventType.RUN_ERROR, message: step.message })
            return
          } else if (step.kind === 'finish') {
            break
          }
        }

        if (interrupted) return
        yield* drain()
        yield event({ type: EventType.RUN_FINISHED, threadId, runId })
      } finally {
        closed = true
        pending?.deferred.resolve('deny')
        pending = null
      }
    })()

    return {
      events,
      approve: async (requestId, decision) => {
        if (closed) throw new Error('fake adapter run is closed')
        if (!pending || pending.requestId !== requestId) {
          throw new Error(`no pending approval ${requestId}`)
        }
        pending.deferred.resolve(decision)
      },
      send: async (delta) => {
        if (closed) throw new Error('fake adapter run is closed')
        queue.push(delta)
      },
      interrupt: async () => {
        interrupted = true
        closed = true
        pending?.deferred.resolve('deny')
        pending = null
      },
      dispose: async () => {
        interrupted = true
        closed = true
        pending?.deferred.resolve('deny')
        pending = null
      },
    }
  }
}
