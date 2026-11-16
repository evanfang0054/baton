import { describe, expect, it } from 'vitest'
import { Approval } from '../src/entities/approval.js'
import { Event } from '../src/entities/event.js'
import { Review } from '../src/entities/review.js'

describe('event/approval/review entities', () => {
  it('requires a global ordinal and a session seq', () => {
    const base = {
      id: 'ev1',
      sessionId: 's1',
      type: 'TEXT_MESSAGE_CONTENT',
      payload: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hi' },
      ts: 1,
    }
    expect(Event.parse({ ...base, ordinal: 10, seq: 1 }).ordinal).toBe(10)
    expect(() => Event.parse({ ...base, seq: 1 })).toThrow()
    expect(() => Event.parse({ ...base, ordinal: -1, seq: 1 })).toThrow()
  })

  it('keeps approval pending with a null decision', () => {
    expect(
      Approval.parse({
        id: 'a1',
        sessionId: 's1',
        request: { toolName: 'Bash', input: { cmd: 'ls' }, risk: 'low' },
        decision: null,
        decidedBy: null,
        decidedAt: null,
      }).decision,
    ).toBeNull()
  })

  it('uses verdict only for the human decision', () => {
    const review = {
      id: 'r1',
      taskId: 't1',
      verifyExitCode: 0,
      verifyOutput: 'ok',
      diffStat: { filesChanged: 1, insertions: 2, deletions: 0 },
      decidedAt: 2,
    }
    expect(Review.parse({ ...review, verdict: 'approved' }).verdict).toBe('approved')
    expect(() => Review.parse({ ...review, verdict: 'passed' })).toThrow()
  })
})
