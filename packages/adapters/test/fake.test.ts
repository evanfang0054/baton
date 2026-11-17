import { EventSchemas, PolicySchema, type AgentEvent, type StartInput } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { FakeAdapter } from '../src/index.js'

const startInput = (): StartInput => ({
  prompt: 'demo',
  cwd: '/workspace/demo',
  permissionMode: 'manual',
  policy: PolicySchema.parse({}),
})

async function waitFor(
  events: AgentEvent[],
  predicate: (event: AgentEvent) => boolean,
): Promise<AgentEvent> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const found = events.find(predicate)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('timed out waiting for event')
}

async function collect(runEvents: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of runEvents) events.push(event)
  return events
}

describe('FakeAdapter', () => {
  it('emits the default text -> approval -> text -> finish sequence', async () => {
    const adapter = new FakeAdapter()
    const run = await adapter.start(startInput())

    const events: AgentEvent[] = []
    const consumed = (async () => {
      for await (const event of run.events) events.push(event)
    })()

    const approval = await waitFor(events, (event) => event.type === 'CUSTOM')
    expect(approval).toMatchObject({ type: 'CUSTOM', name: 'approval.request' })
    const requestId = (approval as { value: { requestId: string } }).value.requestId

    await run.approve(requestId, 'allow')
    await consumed

    expect(events.map((event) => event.type)).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'CUSTOM',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ])
    for (const event of events) expect(() => EventSchemas.parse(event)).not.toThrow()
  })

  it('emits denied text and finishes when approval is denied', async () => {
    const adapter = new FakeAdapter()
    const run = await adapter.start(startInput())
    const events: AgentEvent[] = []
    const consumed = (async () => {
      for await (const event of run.events) events.push(event)
    })()

    const approval = await waitFor(events, (event) => event.type === 'CUSTOM')
    await run.approve((approval as { value: { requestId: string } }).value.requestId, 'deny')
    await consumed

    expect(
      events.some(
        (event) => event.type === 'TEXT_MESSAGE_CONTENT' && event.delta === 'fake: denied',
      ),
    ).toBe(true)
    expect(events.at(-1)?.type).toBe('RUN_FINISHED')
  })

  it('ends the stream on interrupt', async () => {
    const adapter = new FakeAdapter()
    const run = await adapter.start(startInput())
    const consumed = collect(run.events)
    await run.interrupt()
    const events = await consumed
    expect(events.at(-1)?.type).toBe('RUN_STARTED')
  })

  it('send appends a text event', async () => {
    const adapter = new FakeAdapter()
    const run = await adapter.start(startInput())
    const events: AgentEvent[] = []
    const consumed = (async () => {
      for await (const event of run.events) events.push(event)
    })()

    const approval = await waitFor(events, (event) => event.type === 'CUSTOM')
    await run.send('extra instruction')
    await run.approve((approval as { value: { requestId: string } }).value.requestId, 'allow')
    await consumed

    expect(
      events.some(
        (event) => event.type === 'TEXT_MESSAGE_CONTENT' && event.delta === 'extra instruction',
      ),
    ).toBe(true)
  })

  it('supports custom text and error scripts', async () => {
    const textAdapter = new FakeAdapter({ script: [{ kind: 'text', text: 'hello' }] })
    const textRun = await textAdapter.start(startInput())
    const textEvents = await collect(textRun.events)
    expect(
      textEvents.some((event) => event.type === 'TEXT_MESSAGE_CONTENT' && event.delta === 'hello'),
    ).toBe(true)
    expect(textEvents.at(-1)?.type).toBe('RUN_FINISHED')

    const errorAdapter = new FakeAdapter({ script: [{ kind: 'error', message: 'boom' }] })
    const errorRun = await errorAdapter.start(startInput())
    const errorEvents = await collect(errorRun.events)
    expect(errorEvents.at(-1)).toMatchObject({ type: 'RUN_ERROR', message: 'boom' })
  })

  it('rejects an approval with the wrong request id', async () => {
    const adapter = new FakeAdapter()
    const run = await adapter.start(startInput())
    const events: AgentEvent[] = []
    const consumed = (async () => {
      for await (const event of run.events) events.push(event)
    })()

    const approval = await waitFor(events, (event) => event.type === 'CUSTOM')
    await expect(run.approve('wrong-id', 'allow')).rejects.toThrow(/no pending approval/)
    await run.approve((approval as { value: { requestId: string } }).value.requestId, 'allow')
    await consumed
  })

  it('rejects send and approve after the stream closes', async () => {
    const adapter = new FakeAdapter({ script: [{ kind: 'finish' }] })
    const run = await adapter.start(startInput())
    await collect(run.events)

    await expect(run.send('late')).rejects.toThrow(/closed/)
    await expect(run.approve('req-1', 'allow')).rejects.toThrow(/closed/)
  })

  it('dispose stops the stream and clears the pending approval', async () => {
    const adapter = new FakeAdapter()
    const run = await adapter.start(startInput())
    const events: AgentEvent[] = []
    const consumed = (async () => {
      for await (const event of run.events) events.push(event)
    })()

    await waitFor(events, (event) => event.type === 'CUSTOM')
    await run.dispose()
    await consumed

    expect(events.at(-1)?.type).toBe('CUSTOM')
    await expect(run.approve('req-1', 'allow')).rejects.toThrow(/closed/)
  })

  it('interrupt ends a pending approval without emitting a decision', async () => {
    const adapter = new FakeAdapter()
    const run = await adapter.start(startInput())
    const events: AgentEvent[] = []
    const consumed = (async () => {
      for await (const event of run.events) events.push(event)
    })()

    await waitFor(events, (event) => event.type === 'CUSTOM')
    await run.interrupt()
    await consumed

    expect(events.at(-1)?.type).toBe('CUSTOM')
    expect(events.some((event) => event.type === 'RUN_FINISHED')).toBe(false)
  })

  it('finish stops the script instead of continuing to the next step', async () => {
    const adapter = new FakeAdapter({
      script: [
        { kind: 'text', text: 'before' },
        { kind: 'finish' },
        {
          kind: 'approval',
          request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' },
        },
      ],
    })
    const run = await adapter.start(startInput())
    const events = await collect(run.events)
    expect(events.some((event) => event.type === 'CUSTOM')).toBe(false)
    expect(events.at(-1)?.type).toBe('RUN_FINISHED')
  })
})
