import { describe, expect, it } from 'vitest'
import { TaskTransitionEvent } from '../src/transitions.js'

const diffStat = { filesChanged: 1, insertions: 2, deletions: 0 }

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

describe('TaskTransitionEvent', () => {
  it.each(events)('round-trips $type without dropping fields', (event) => {
    expect(TaskTransitionEvent.parse(event)).toEqual(event)
  })

  it('enforces exit code, feedback, and note constraints', () => {
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
    expect(() =>
      TaskTransitionEvent.parse({ type: 'approval_deny', approvalId: 'a1', note: '' }),
    ).toThrow()
    expect(() => TaskTransitionEvent.parse({ type: 'cancel', reason: '' })).toThrow()
    expect(() => TaskTransitionEvent.parse({ type: 'error', message: '' })).toThrow()
  })
})
