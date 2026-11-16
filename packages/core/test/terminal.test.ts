import type { TaskStatus, TaskTransitionEvent } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { transition } from '../src/state-machine/index.js'
import type { TransitionContext } from '../src/state-machine/types.js'

const TERMINAL: TaskStatus[] = ['done', 'failed', 'cancelled']
const EVENT: TaskTransitionEvent = { type: 'enqueue' }

const ctx = (status: TaskStatus): TransitionContext => ({
  status,
  retryCount: 0,
  runningCount: 0,
  maxConcurrency: 1,
  autopilot: { enabled: false, retryMax: 2 },
})

describe('terminal states', () => {
  it('rejects every event from terminal states', () => {
    for (const status of TERMINAL) {
      const result = transition(ctx(status), EVENT)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('invalid_transition')
    }
  })

  it('cancel from review has no interruptSession', () => {
    const result = transition(ctx('review'), { type: 'cancel' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.status).toBe('cancelled')
      expect(result.effects).not.toContainEqual({ type: 'interruptSession' })
    }
  })

  it('cancel from running interrupts the session', () => {
    const result = transition(ctx('running'), { type: 'cancel' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.effects).toContainEqual({ type: 'interruptSession' })
  })
})
