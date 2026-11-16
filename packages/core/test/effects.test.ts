import { describe, expect, it } from 'vitest'
import { transition } from '../src/state-machine/index.js'
import type { TransitionContext } from '../src/state-machine/types.js'

const ctx = (overrides: Partial<TransitionContext>): TransitionContext => ({
  status: 'todo',
  retryCount: 0,
  runningCount: 0,
  maxConcurrency: 1,
  autopilot: { enabled: false, retryMax: 2 },
  ...overrides,
})

const diff = { filesChanged: 1, insertions: 2, deletions: 0 }

describe('effects snapshots', () => {
  it('happy path', () => {
    expect(transition(ctx({ status: 'todo' }), { type: 'enqueue' })).toMatchSnapshot()
    expect(transition(ctx({ status: 'queued' }), { type: 'start' })).toMatchSnapshot()
    expect(transition(ctx({ status: 'running' }), { type: 'completed' })).toMatchSnapshot()
    expect(
      transition(ctx({ status: 'verifying' }), {
        type: 'verify_ok',
        reviewId: 'r1',
        exitCode: 0,
        output: 'ok',
        diffStat: diff,
      }),
    ).toMatchSnapshot()
    expect(
      transition(ctx({ status: 'review' }), { type: 'approve', reviewId: 'r1' }),
    ).toMatchSnapshot()
  })

  it('verify fail retry', () => {
    expect(
      transition(ctx({ status: 'verifying', autopilot: { enabled: true, retryMax: 2 } }), {
        type: 'verify_fail',
        reviewId: 'r1',
        exitCode: 1,
        output: 'bad',
        diffStat: diff,
      }),
    ).toMatchSnapshot()
  })

  it('reject does not increment retry', () => {
    const result = transition(ctx({ status: 'review', retryCount: 1 }), {
      type: 'reject',
      reviewId: 'r1',
      feedback: 'fix it',
    })
    expect(result).toMatchObject({ ok: true, status: 'queued', retryCount: 1 })
    expect(result.ok && result.effects).not.toContainEqual({ type: 'incrementRetry' })
    expect(result).toMatchSnapshot()
  })

  it('every successful transition emits exactly one task status', () => {
    const result = transition(ctx({ status: 'todo' }), { type: 'enqueue' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.effects.filter((effect) => effect.type === 'emitTaskStatus')).toHaveLength(1)
    }
  })
})
