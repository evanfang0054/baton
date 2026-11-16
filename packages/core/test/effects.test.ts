import type { TaskTransitionEvent } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { transition } from '../src/state-machine/index.js'
import { ctx, diff, expectOk } from './helpers.js'

const verifyOk: TaskTransitionEvent = {
  type: 'verify_ok',
  reviewId: 'r1',
  exitCode: 0,
  output: 'ok',
  diffStat: diff,
}

const verifyFail: TaskTransitionEvent = {
  type: 'verify_fail',
  reviewId: 'r1',
  exitCode: 1,
  output: 'bad',
  diffStat: diff,
}

describe('effects snapshots', () => {
  it('happy path', () => {
    expect(transition(ctx('todo'), { type: 'enqueue' })).toMatchSnapshot()
    expect(transition(ctx('queued'), { type: 'start' })).toMatchSnapshot()
    expect(transition(ctx('running'), { type: 'completed' })).toMatchSnapshot()
    expect(transition(ctx('verifying'), verifyOk)).toMatchSnapshot()
    expect(transition(ctx('review'), { type: 'approve', reviewId: 'r1' })).toMatchSnapshot()
  })

  it('approval request, allow and deny', () => {
    expect(
      transition(ctx('running'), { type: 'approval_requested', approvalId: 'a1' }),
    ).toMatchSnapshot()
    expect(
      transition(ctx('waiting_input'), { type: 'approval_allow', approvalId: 'a1' }),
    ).toMatchSnapshot()
    expect(
      transition(ctx('waiting_input'), {
        type: 'approval_deny',
        approvalId: 'a1',
        note: 'use soft delete',
      }),
    ).toMatchSnapshot()
  })

  it('verify fail retry', () => {
    expect(
      transition(ctx('verifying', { autopilot: { enabled: true, retryMax: 2 } }), verifyFail),
    ).toMatchSnapshot()
  })

  it('verify fail without autopilot goes to review', () => {
    expect(transition(ctx('verifying'), verifyFail)).toMatchSnapshot()
  })

  it('error from waiting_input interrupts the session', () => {
    expect(transition(ctx('waiting_input'), { type: 'error', message: 'boom' })).toMatchSnapshot()
  })

  it('reject does not increment retry', () => {
    const result = expectOk(
      transition(ctx('review', { retryCount: 1 }), {
        type: 'reject',
        reviewId: 'r1',
        feedback: 'fix it',
      }),
    )
    expect(result.retryCount).toBe(1)
    expect(result.effects).not.toContainEqual({ type: 'incrementRetry' })
    expect(result).toMatchSnapshot()
  })

  it('every successful transition emits exactly one task status', () => {
    const result = expectOk(transition(ctx('todo'), { type: 'enqueue' }))
    expect(result.effects.filter((effect) => effect.type === 'emitTaskStatus')).toHaveLength(1)
  })
})
