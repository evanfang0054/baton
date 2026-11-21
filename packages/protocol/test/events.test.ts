import { describe, expect, it } from 'vitest'
import { ApprovalRequestValue, ServerMessage } from '../src/events.js'

const aguiEvent = { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hi' }

const fixtures = [
  ['ack', { commandId: 'c1', ok: true }],
  ['error', { code: 'invalid_transition', message: 'no' }],
  [
    'task.status',
    { taskId: 't1', status: 'running', previousStatus: 'queued', retryCount: 0, updatedAt: 2 },
  ],
  ['session.event', { sessionId: 's1', seq: 1, event: aguiEvent }],
  [
    'approval.request',
    {
      approvalId: 'a1',
      sessionId: 's1',
      request: { toolName: 'Bash', input: {}, risk: 'low' },
    },
  ],
  [
    'verify.result',
    {
      taskId: 't1',
      reviewId: 'r1',
      exitCode: 0,
      output: 'ok',
      diffStat: { filesChanged: 1, insertions: 1, deletions: 0 },
      durationMs: 10,
    },
  ],
  ['review.preliminary', { taskId: 't1', reviewId: 'r1', verdict: 'pass', at: 2 }],
] as const

describe('ServerMessage', () => {
  it.each(fixtures)('parses %s', (type, payload) => {
    const parsed = ServerMessage.parse({ v: 1, ts: 1, seq: 1, type, payload })
    expect(parsed.type).toBe(type)
  })

  it('allows optional ack data', () => {
    const withData = ServerMessage.parse({
      v: 1,
      ts: 1,
      type: 'ack',
      payload: { commandId: 'c1', ok: true, data: { taskId: 't1' } },
    })
    expect(withData.type).toBe('ack')
    if (withData.type === 'ack') expect(withData.payload.data).toEqual({ taskId: 't1' })

    const withoutData = ServerMessage.parse({
      v: 1,
      ts: 1,
      type: 'ack',
      payload: { commandId: 'c1', ok: true },
    })
    if (withoutData.type === 'ack') expect(withoutData.payload.data).toBeUndefined()
  })

  it('requires seq on replayable events and allows it to be omitted on ack/error', () => {
    expect(
      ServerMessage.parse({
        v: 1,
        ts: 1,
        type: 'ack',
        payload: { commandId: 'c1', ok: true },
      }).type,
    ).toBe('ack')
    expect(
      ServerMessage.parse({
        v: 1,
        ts: 1,
        type: 'error',
        payload: { code: 'invalid_transition', message: 'no' },
      }).type,
    ).toBe('error')

    const replayable = fixtures.filter(([type]) => type !== 'ack' && type !== 'error')
    for (const [type, payload] of replayable) {
      expect(() => ServerMessage.parse({ v: 1, ts: 1, type, payload })).toThrow()
    }
  })

  it('accepts session.event replay rows without seq', () => {
    const parsed = ServerMessage.parse({
      v: 1,
      ts: 1,
      seq: 1,
      type: 'session.event',
      payload: {
        sessionId: 's1',
        event: { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' },
      },
    })
    expect(parsed.type).toBe('session.event')
    if (parsed.type === 'session.event') expect(parsed.payload.seq).toBeUndefined()
  })

  it('parses the shared approval request value', () => {
    const parsed = ApprovalRequestValue.parse({
      requestId: 'req-1',
      request: { toolName: 'Bash', input: {}, risk: 'low' },
    })
    expect(parsed.requestId).toBe('req-1')
    expect(() =>
      ApprovalRequestValue.parse({ requestId: '', request: { toolName: 'Bash', input: {} } }),
    ).toThrow()
  })
})
