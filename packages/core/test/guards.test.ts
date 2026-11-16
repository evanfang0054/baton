import type { TaskTransitionEvent } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { transition } from '../src/state-machine/index.js'
import { ctx, diff, expectOk } from './helpers.js'

const verifyFail: TaskTransitionEvent = {
  type: 'verify_fail',
  reviewId: 'r1',
  exitCode: 1,
  output: 'bad',
  diffStat: diff,
}

describe('guards', () => {
  it('rejects start when concurrency is full', () => {
    const result = transition(ctx('queued', { runningCount: 1 }), { type: 'start' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('guard_failed')
  })

  it('starts when a slot is free', () => {
    expect(expectOk(transition(ctx('queued'), { type: 'start' })).status).toBe('running')
  })

  it('goes to review when autopilot is disabled', () => {
    const result = expectOk(transition(ctx('verifying'), verifyFail))
    expect(result.status).toBe('review')
    expect(result.effects).not.toContainEqual({ type: 'incrementRetry' })
  })

  it('goes to review when retryMax is 0', () => {
    const result = expectOk(
      transition(ctx('verifying', { autopilot: { enabled: true, retryMax: 0 } }), verifyFail),
    )
    expect(result.status).toBe('review')
    expect(result.effects).not.toContainEqual({ type: 'incrementRetry' })
  })

  it('retries when retryMax is 1 and retryCount is 0', () => {
    const result = expectOk(
      transition(ctx('verifying', { autopilot: { enabled: true, retryMax: 1 } }), verifyFail),
    )
    expect(result.status).toBe('queued')
    expect(result.retryCount).toBe(1)
    expect(result.effects).toContainEqual({ type: 'incrementRetry' })
  })

  it('goes to review when retryMax is 1 and retryCount is 1', () => {
    const result = expectOk(
      transition(
        ctx('verifying', { retryCount: 1, autopilot: { enabled: true, retryMax: 1 } }),
        verifyFail,
      ),
    )
    expect(result.status).toBe('review')
    expect(result.retryCount).toBe(1)
    expect(result.effects).not.toContainEqual({ type: 'incrementRetry' })
  })

  it('retries when retryMax is 2 and retryCount is 1', () => {
    const result = expectOk(
      transition(
        ctx('verifying', { retryCount: 1, autopilot: { enabled: true, retryMax: 2 } }),
        verifyFail,
      ),
    )
    expect(result.status).toBe('queued')
    expect(result.retryCount).toBe(2)
    expect(result.effects).toContainEqual({ type: 'incrementRetry' })
  })

  it('goes to review when retryMax is 2 and retryCount is 2', () => {
    const result = expectOk(
      transition(
        ctx('verifying', { retryCount: 2, autopilot: { enabled: true, retryMax: 2 } }),
        verifyFail,
      ),
    )
    expect(result.status).toBe('review')
    expect(result.retryCount).toBe(2)
    expect(result.effects).not.toContainEqual({ type: 'incrementRetry' })
  })

  it('rejects a malformed verify_ok at runtime', () => {
    const malformed = {
      type: 'verify_ok',
      reviewId: 'r1',
      exitCode: 1,
      output: 'bad',
      diffStat: diff,
    } as unknown as TaskTransitionEvent
    const result = transition(ctx('verifying'), malformed)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_transition')
  })

  it('does not increment retryCount on reject', () => {
    const result = expectOk(
      transition(ctx('review', { retryCount: 1 }), {
        type: 'reject',
        reviewId: 'r1',
        feedback: 'fix it',
      }),
    )
    expect(result.status).toBe('queued')
    expect(result.retryCount).toBe(1)
    expect(result.effects).not.toContainEqual({ type: 'incrementRetry' })
    expect(result.effects).toContainEqual({ type: 'appendFeedback', feedback: 'fix it' })
  })
})
