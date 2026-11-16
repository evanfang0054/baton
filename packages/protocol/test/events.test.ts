import { describe, expect, it } from 'vitest'
import { ServerMessage } from '../src/events.js'

const aguiEvent = { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hi' }

const fixtures = [
  ['ack', { commandId: 'c1', ok: true }],
  ['error', { code: 'invalid_transition', message: 'no' }],
  [
    'task.status',
    { taskId: 't1', status: 'running', previousStatus: 'queued', retryCount: 0, updatedAt: 2 },
  ],
  ['session.event', { sessionId: 's1', event: aguiEvent }],
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
] as const

describe('ServerMessage', () => {
  it.each(fixtures)('parses %s', (type, payload) => {
    const parsed = ServerMessage.parse({ v: 1, ts: 1, seq: 1, type, payload })
    expect(parsed.type).toBe(type)
  })
})
