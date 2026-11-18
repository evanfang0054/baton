import { describe, expect, it } from 'vitest'
import { attentionFor, transition } from '../src/index.js'
import { ctx } from './helpers.js'

const base = ctx('running', { runningCount: 1 })

describe('attention transitions', () => {
  it('moves blocked to waiting_input(question)', () => {
    const result = transition(base, { type: 'session_reported', outcome: 'blocked' })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.status).toBe('waiting_input')
    expect(result.waitingReason).toBe('question')
    expect(result.effects.at(-1)?.type).toBe('emitTaskStatus')
  })

  it('moves dropped to waiting_input(dropped)', () => {
    const result = transition(base, { type: 'session_reported', outcome: 'dropped' })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.status).toBe('waiting_input')
    expect(result.waitingReason).toBe('dropped')
  })

  it('moves unreported to waiting_input(stalled)', () => {
    const result = transition(base, { type: 'session_reported', outcome: 'unreported' })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.status).toBe('waiting_input')
    expect(result.waitingReason).toBe('stalled')
  })

  it('refreshes a waiting task to stalled on an unreported session', () => {
    const result = transition(
      { ...base, status: 'waiting_input', waitingReason: 'question' },
      { type: 'session_reported', outcome: 'unreported', reason: 'daemon restarted' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.status).toBe('waiting_input')
    expect(result.waitingReason).toBe('stalled')
    expect(result.effects.at(-1)?.type).toBe('emitTaskStatus')
  })

  it('updates waiting reason on a repeated blocked/dropped report', () => {
    const blocked = transition(
      { ...base, status: 'waiting_input', waitingReason: 'stalled' },
      { type: 'session_reported', outcome: 'blocked' },
    )
    expect(blocked.ok && blocked.waitingReason).toBe('question')
    const dropped = transition(
      { ...base, status: 'waiting_input', waitingReason: 'stalled' },
      { type: 'session_reported', outcome: 'dropped' },
    )
    expect(dropped.ok && dropped.waitingReason).toBe('dropped')
  })

  it('allows a stalled task to be re-enqueued', () => {
    const result = transition(
      { ...base, status: 'waiting_input', waitingReason: 'stalled' },
      { type: 'enqueue' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.status).toBe('queued')
    expect(result.effects[0]).toEqual({ type: 'enqueueTask' })
  })

  it('accepts user input only for non-approval waiting', () => {
    const ok = transition(
      { ...base, status: 'waiting_input', waitingReason: 'question' },
      { type: 'user_input', text: 'use option B' },
    )
    expect(ok.ok).toBe(true)
    if (!ok.ok) {
      return
    }
    expect(ok.status).toBe('running')
    expect(ok.waitingReason).toBeNull()
    expect(ok.effects.slice(0, 2)).toEqual([
      { type: 'sendToSession', text: 'use option B' },
      { type: 'appendUserReply', text: 'use option B' },
    ])

    const denied = transition(
      { ...base, status: 'waiting_input', waitingReason: 'approval' },
      { type: 'user_input', text: 'use option B' },
    )
    expect(denied.ok).toBe(false)
    if (denied.ok) {
      return
    }
    expect(denied.error.code).toBe('invalid_transition')
  })

  it('maps attention from status and waiting reason', () => {
    expect(attentionFor('waiting_input', 'approval')).toBe('needs_approval')
    expect(attentionFor('waiting_input', null)).toBe('needs_approval')
    expect(attentionFor('waiting_input', 'question')).toBe('needs_reply')
    expect(attentionFor('waiting_input', 'stalled')).toBe('needs_attention')
    expect(attentionFor('waiting_input', 'dropped')).toBe('needs_reply')
    expect(attentionFor('review', null)).toBe('needs_review')
    expect(attentionFor('running', null)).toBe('none')
  })
})
