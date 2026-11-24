import { EventSchemas, PolicySchema, type AgentEvent, type StartInput } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { ClaudeAdapter } from '../../src/claude/adapter.js'
import type {
  ClaudeEvent,
  ClaudeTransport,
  ClaudeTransportInput,
} from '../../src/claude/transport.js'

class FakeTransport implements ClaudeTransport {
  private readonly queue: ClaudeEvent[] = []
  private readonly waiters: Array<(result: IteratorResult<ClaudeEvent>) => void> = []
  private closed = false
  readonly sent: string[] = []
  readonly approvals: Array<{ requestId: string; decision: string; note?: string }> = []
  readonly answers: Array<{
    requestId: string
    answers: Record<string, string>
    response?: string
  }> = []

  push(event: ClaudeEvent): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value: event, done: false })
    } else {
      this.queue.push(event)
    }
  }

  close(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true })
    }
  }

  readonly events: AsyncIterable<ClaudeEvent> = {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        const value = this.queue.shift()
        if (value !== undefined) {
          return Promise.resolve({ value, done: false })
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true })
        }
        return new Promise((resolve) => this.waiters.push(resolve))
      },
    }),
  }

  async send(text: string): Promise<void> {
    if (this.closed) throw new Error('session_closed')
    this.sent.push(text)
  }

  async approve(requestId: string, decision: 'allow' | 'deny', note?: string): Promise<void> {
    this.approvals.push({ requestId, decision, ...(note ? { note } : {}) })
  }

  async answerQuestion(
    requestId: string,
    answers: Record<string, string>,
    response?: string,
  ): Promise<void> {
    this.answers.push({ requestId, answers, ...(response ? { response } : {}) })
  }

  async interrupt(): Promise<void> {
    this.close()
  }

  async dispose(): Promise<void> {
    this.close()
  }
}

const startInput = (): StartInput => ({
  prompt: 'demo',
  cwd: '/workspace/demo',
  permissionMode: 'manual',
  policy: PolicySchema.parse({}),
  workspaceTrust: { projectSettings: true, projectHooks: false },
  bypassPermissions: false,
})

async function collect(run: { events: AsyncIterable<AgentEvent> }): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of run.events) {
    events.push(EventSchemas.parse(event))
    if (event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR') break
  }
  return events
}

function makeRun(transport: FakeTransport): Promise<{
  run: Awaited<ReturnType<ClaudeAdapter['start']>>
  captured: ClaudeTransportInput
}> {
  const adapter = new ClaudeAdapter({
    transportFactory: async (input) => {
      captured = input
      return transport
    },
  })
  let captured!: ClaudeTransportInput
  return adapter.start(startInput()).then((run) => ({ run, captured }))
}

describe('ClaudeAdapter', () => {
  it('maps init, text, tool use and tool result', async () => {
    const transport = new FakeTransport()
    const { run, captured } = await makeRun(transport)
    transport.push({ type: 'init', sessionId: 'session-1' })
    transport.push({ type: 'text', text: 'hello' })
    transport.push({ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'a.ts' } })
    transport.push({ type: 'tool_result', toolUseId: 'tool-1', content: 'file', isError: false })
    transport.push({ type: 'turn_result', ok: true })
    transport.close()

    const events = await collect(run)
    expect(events.map((event) => event.type)).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      'TOOL_CALL_RESULT',
      'RUN_FINISHED',
    ])
    expect(captured.workspaceTrust).toEqual({ projectSettings: true, projectHooks: false })
    expect(captured.systemPromptAppend).toContain('baton_report')
  })

  it('bridges approvals and keeps blocked sessions open until send', async () => {
    const transport = new FakeTransport()
    const { run } = await makeRun(transport)
    transport.push({ type: 'init', sessionId: 'session-1' })
    transport.push({
      type: 'approval_request',
      requestId: 'req-1',
      request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'high' },
    })
    transport.push({ type: 'outcome', outcome: 'blocked', reason: 'need a decision' })
    transport.push({ type: 'turn_result', ok: true })
    const events: AgentEvent[] = []
    const iterator = run.events[Symbol.asyncIterator]()
    for (let index = 0; index < 3; index += 1) {
      const next = await iterator.next()
      events.push(EventSchemas.parse(next.value))
    }

    expect(events.map((event) => event.type)).toContain('CUSTOM')
    await run.approve('req-1', 'allow', 'go')
    expect(transport.approvals).toEqual([{ requestId: 'req-1', decision: 'allow', note: 'go' }])

    transport.push({ type: 'text', text: 'resumed' })
    transport.push({ type: 'outcome', outcome: 'ready' })
    transport.push({ type: 'turn_result', ok: true })
    transport.close()
    let finished = false
    for (;;) {
      const next = await iterator.next()
      if (next.done) break
      if (next.value.type === 'RUN_FINISHED') {
        finished = true
        break
      }
    }
    expect(transport.sent).toEqual([])
    expect(finished).toBe(true)
  })

  it('routes structured answers through answerQuestion', async () => {
    const transport = new FakeTransport()
    const { run } = await makeRun(transport)
    transport.push({ type: 'init', sessionId: 'session-1' })
    transport.push({
      type: 'approval_request',
      requestId: 'req-q',
      request: { toolName: 'AskUserQuestion', input: { questions: [] }, risk: 'high' },
    })
    transport.push({ type: 'outcome', outcome: 'blocked' })
    const iterator = run.events[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()

    await run.answerQuestion('req-q', { '选哪个？': 'A' }, '补充说明')
    expect(transport.answers).toEqual([
      { requestId: 'req-q', answers: { '选哪个？': 'A' }, response: '补充说明' },
    ])
    await run.interrupt()
  })

  it('emits session usage before RUN_FINISHED when a ready outcome is followed by turn_result', async () => {
    const transport = new FakeTransport()
    const { run } = await makeRun(transport)
    transport.push({ type: 'init', sessionId: 'session-1' })
    transport.push({ type: 'outcome', outcome: 'ready', reason: 'done' })
    transport.push({ type: 'turn_result', ok: true, costUsd: 0.42, turns: 3 })
    transport.close()
    const events = await collect(run)
    const usageIndex = events.findIndex(
      (event) => event.type === 'CUSTOM' && event.name === 'baton.session.usage',
    )
    const finishIndex = events.findIndex((event) => event.type === 'RUN_FINISHED')
    expect(usageIndex).toBeGreaterThan(-1)
    expect(finishIndex).toBeGreaterThan(usageIndex)
    expect(events[usageIndex]).toMatchObject({
      type: 'CUSTOM',
      name: 'baton.session.usage',
      value: { costUsd: 0.42, turns: 3 },
    })
  })

  it('finishes when a ready outcome arrives without a turn_result', async () => {
    const transport = new FakeTransport()
    const { run } = await makeRun(transport)
    transport.push({ type: 'init', sessionId: 'session-1' })
    transport.push({ type: 'outcome', outcome: 'ready', reason: 'done' })
    transport.close()
    const events = await collect(run)
    expect(events.at(-1)?.type).toBe('RUN_FINISHED')
    expect(
      events.some((event) => event.type === 'CUSTOM' && event.name === 'session.outcome'),
    ).toBe(true)
  })

  it('ends an unreported turn without synthesizing an outcome', async () => {
    const transport = new FakeTransport()
    const { run } = await makeRun(transport)
    transport.push({ type: 'init', sessionId: 'session-1' })
    transport.push({ type: 'turn_result', ok: true })
    transport.close()
    const events = await collect(run)
    expect(
      events.some((event) => event.type === 'CUSTOM' && event.name === 'session.outcome'),
    ).toBe(false)
    expect(events.at(-1)?.type).toBe('RUN_FINISHED')
  })

  it('maps a failed turn to RUN_ERROR and rejects send after close', async () => {
    const transport = new FakeTransport()
    const { run } = await makeRun(transport)
    transport.push({ type: 'init', sessionId: 'session-1' })
    transport.push({ type: 'turn_result', ok: false, error: 'boom' })
    transport.close()
    const events = await collect(run)
    expect(events.at(-1)).toMatchObject({ type: 'RUN_ERROR', message: 'boom' })

    await expect(run.send('late')).rejects.toThrow('session_closed')
    await expect(run.approve('req-1', 'allow')).rejects.toThrow('session_closed')
  })
})
