import { describe, expect, it } from 'vitest'
import { transition } from '../src/state-machine/index.js'
import type { TransitionContext } from '../src/state-machine/types.js'

const base: TransitionContext = {
  status: 'queued',
  retryCount: 0,
  runningCount: 0,
  maxConcurrency: 1,
  autopilot: { enabled: false, retryMax: 2 },
}

const diff = { filesChanged: 1, insertions: 1, deletions: 0 }

describe('guards', () => {
  it('rejects start when concurrency is full', () => {
    const result = transition({ ...base, runningCount: 1 }, { type: 'start' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('guard_failed')
  })

  it('starts when a slot is free', () => {
    expect(transition(base, { type: 'start' })).toMatchObject({ ok: true, status: 'running' })
  })

  it('retries verify_fail when autopilot is on and under retryMax', () => {
    const result = transition(
      { ...base, status: 'verifying', retryCount: 1, autopilot: { enabled: true, retryMax: 2 } },
      { type: 'verify_fail', reviewId: 'r1', exitCode: 1, output: 'bad', diffStat: diff },
    )
    expect(result).toMatchObject({ ok: true, status: 'queued', retryCount: 2 })
    if (result.ok) expect(result.effects).toContainEqual({ type: 'incrementRetry' })
  })

  it('goes to review at retryMax', () => {
    const result = transition(
      { ...base, status: 'verifying', retryCount: 2, autopilot: { enabled: true, retryMax: 2 } },
      { type: 'verify_fail', reviewId: 'r1', exitCode: 1, output: 'bad', diffStat: diff },
    )
    expect(result).toMatchObject({ ok: true, status: 'review', retryCount: 2 })
    if (result.ok) expect(result.effects).not.toContainEqual({ type: 'incrementRetry' })
  })

  it('does not increment retryCount on reject', () => {
    const result = transition(
      { ...base, status: 'review', retryCount: 1 },
      { type: 'reject', reviewId: 'r1', feedback: 'fix it' },
    )
    expect(result).toMatchObject({ ok: true, status: 'queued', retryCount: 1 })
    if (result.ok) {
      expect(result.effects).not.toContainEqual({ type: 'incrementRetry' })
      expect(result.effects).toContainEqual({ type: 'appendFeedback', feedback: 'fix it' })
    }
  })
})
