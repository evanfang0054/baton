import { describe, expect, it } from 'vitest'
import { TaskTransitionEvent } from '../src/transitions.js'

const diffStat = { filesChanged: 1, insertions: 2, deletions: 0 }

describe('TaskTransitionEvent', () => {
  it('parses the twelve transition events', () => {
    const events = [
      { type: 'enqueue' },
      { type: 'start' },
      { type: 'approval_requested', approvalId: 'a1' },
      { type: 'approval_allow', approvalId: 'a1' },
      { type: 'approval_deny', approvalId: 'a1', note: 'no' },
      { type: 'completed' },
      { type: 'verify_ok', reviewId: 'r1', exitCode: 0, output: 'ok', diffStat },
      { type: 'verify_fail', reviewId: 'r1', exitCode: 1, output: 'bad', diffStat },
      { type: 'approve', reviewId: 'r1' },
      { type: 'reject', reviewId: 'r1', feedback: 'fix it' },
      { type: 'cancel', reason: 'user' },
      { type: 'error', message: 'boom' },
    ] as const
    for (const event of events) {
      expect(TaskTransitionEvent.parse(event).type).toBe(event.type)
    }
  })

  it('enforces exit code and feedback constraints', () => {
    expect(() =>
      TaskTransitionEvent.parse({
        type: 'verify_ok',
        reviewId: 'r1',
        exitCode: 1,
        output: '',
        diffStat,
      }),
    ).toThrow()
    expect(() =>
      TaskTransitionEvent.parse({
        type: 'verify_fail',
        reviewId: 'r1',
        exitCode: 0,
        output: '',
        diffStat,
      }),
    ).toThrow()
    expect(() =>
      TaskTransitionEvent.parse({ type: 'reject', reviewId: 'r1', feedback: '' }),
    ).toThrow()
  })
})
