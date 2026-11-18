import { describe, expect, it } from 'vitest'
import { Approval } from '../src/entities/approval.js'
import { Audit } from '../src/entities/audit.js'
import { Event } from '../src/entities/event.js'
import { Notice } from '../src/entities/notice.js'
import { Review } from '../src/entities/review.js'

const eventBase = {
  id: 'ev1',
  sessionId: 's1',
  type: 'TEXT_MESSAGE_CONTENT',
  payload: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hi' },
  ts: 1,
}

const approvalBase = {
  id: 'a1',
  sessionId: 's1',
  request: { toolName: 'Bash', input: { cmd: 'ls' }, risk: 'low' },
  decision: null,
  decidedBy: null,
  decidedAt: null,
  response: null,
}

const reviewBase = {
  id: 'r1',
  taskId: 't1',
  verdict: null,
  verifyExitCode: 0,
  verifyOutput: 'ok',
  diffStat: { filesChanged: 1, insertions: 2, deletions: 0 },
  decidedAt: null,
}

describe('event/approval/review/audit/notice entities', () => {
  it('parses Event and rejects missing, negative, or non-integer cursors', () => {
    expect(Event.parse({ ...eventBase, ordinal: 10, seq: 1 })).toEqual({
      ...eventBase,
      ordinal: 10,
      seq: 1,
    })
    expect(() => Event.parse({ ...eventBase, seq: 1 })).toThrow()
    expect(() => Event.parse({ ...eventBase, ordinal: -1, seq: 1 })).toThrow()
    expect(() => Event.parse({ ...eventBase, ordinal: 10 })).toThrow()
    expect(() => Event.parse({ ...eventBase, ordinal: 10, seq: -1 })).toThrow()
    expect(() => Event.parse({ ...eventBase, ordinal: 10, seq: 1.5 })).toThrow()
  })

  it('parses a pending Approval and rejects an invalid risk', () => {
    expect(Approval.parse(approvalBase)).toEqual(approvalBase)
    expect(() =>
      Approval.parse({ ...approvalBase, request: { ...approvalBase.request, risk: 'extreme' } }),
    ).toThrow()
    expect(() => Approval.parse({ ...approvalBase, request: { toolName: 'Bash' } })).toThrow()
  })

  it('parses Review and keeps verdict separate from verify evidence', () => {
    expect(Review.parse(reviewBase)).toEqual(reviewBase)
    expect(Review.parse({ ...reviewBase, verdict: 'approved' }).verdict).toBe('approved')
    expect(() => Review.parse({ ...reviewBase, verdict: 'passed' })).toThrow()
    const missingExitCode = { ...reviewBase }
    delete (missingExitCode as { verifyExitCode?: unknown }).verifyExitCode
    expect(() => Review.parse(missingExitCode)).toThrow()
  })

  it('parses Audit and rejects a missing actor', () => {
    const audit = { id: 'au1', ts: 1, actor: 'user', action: 'approve', detail: { taskId: 't1' } }
    expect(Audit.parse(audit)).toEqual(audit)
    expect(() => Audit.parse({ ...audit, actor: '' })).toThrow()
  })

  it('parses Notice and rejects a missing kind', () => {
    const notice = { id: 'no1', ts: 1, kind: 'digest', payload: {}, readAt: null }
    expect(Notice.parse(notice)).toEqual(notice)
    expect(() => Notice.parse({ ...notice, kind: '' })).toThrow()
  })
})
