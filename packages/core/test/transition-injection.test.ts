import type { ContextInjection } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { effects } from '../src/state-machine/effects.js'
import { transition } from '../src/state-machine/transition.js'

const injection: ContextInjection = {
  seq: 1,
  at: 1,
  source: 'user',
  note: '补充',
  requestId: null,
  nodeIds: ['n1'],
  included: [],
  dropped: [],
  truncated: false,
  relations: [],
  relationsTruncated: false,
  chars: 0,
}

const base = {
  status: 'waiting_input' as const,
  retryCount: 0,
  runningCount: 0,
  maxConcurrency: 1,
  autopilot: { enabled: false, retryMax: 3 },
  workspaceTrusted: true,
  killSwitch: false,
  waitingReason: 'question' as const,
}

describe('transition context injection', () => {
  it('adds appendContextInjection to user_input', () => {
    const result = transition(base, {
      type: 'user_input',
      text: '继续',
      contextInjection: injection,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.effects).toEqual([
        effects.sendToSession('继续'),
        effects.appendUserReply('继续'),
        effects.appendContextInjection(injection),
        effects.emitTaskStatus('running'),
      ])
    }
  })

  it('adds appendContextInjection with block to reject', () => {
    const result = transition(
      { ...base, status: 'review', waitingReason: null },
      {
        type: 'reject',
        reviewId: 'r1',
        feedback: '改',
        contextInjection: injection,
        contextBlock: '<context_update/>',
      },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.effects).toEqual([
        effects.persistReviewVerdict('r1', 'rejected'),
        effects.appendFeedback('改'),
        effects.appendContextInjection(injection, '<context_update/>'),
        effects.enqueueTask(),
        effects.emitTaskStatus('queued', { reviewId: 'r1' }),
      ])
    }
  })

  it('does not add the effect without context', () => {
    const result = transition(base, { type: 'user_input', text: '继续' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.effects.some((effect) => effect.type === 'appendContextInjection')).toBe(false)
    }
  })
})
