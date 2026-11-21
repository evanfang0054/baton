import { describe, expect, it } from 'vitest'
import { attentionFor, canAcceptUserInput, transition } from '../src/index.js'
import { ctx } from './helpers.js'

describe('budget transitions', () => {
  it('stops a running task at budget', () => {
    const result = transition(
      ctx('running', { runningCount: 1 }),
      { type: 'budget_exceeded' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status).toBe('waiting_input')
    expect(result.waitingReason).toBe('budget')
    expect(result.effects).toContainEqual({ type: 'interruptSession', reason: 'budget_exceeded' })
  })

  it('parks a queued task at budget without interrupting a session', () => {
    const result = transition(ctx('queued'), { type: 'budget_exceeded' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status).toBe('waiting_input')
    expect(result.waitingReason).toBe('budget')
    expect(result.effects).not.toContainEqual(expect.objectContaining({ type: 'interruptSession' }))
  })

  it('raises budget back to queued', () => {
    const result = transition(
      ctx('waiting_input', { waitingReason: 'budget' }),
      { type: 'budget_raise', budgetUsd: 3 },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status).toBe('queued')
    expect(result.effects).toContainEqual({ type: 'enqueueTask' })
  })

  it('rejects budget_raise when not waiting for budget', () => {
    const result = transition(
      ctx('waiting_input', { waitingReason: 'approval' }),
      { type: 'budget_raise', budgetUsd: 3 },
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_transition' } })
  })

  it('refuses start when budget is exhausted', () => {
    const result = transition(ctx('queued', { budgetRemainingUsd: 0 }), { type: 'start' })
    expect(result).toMatchObject({ ok: false, error: { code: 'budget_exhausted' } })
  })

  it('starts when budget remains', () => {
    const result = transition(ctx('queued', { budgetRemainingUsd: 0.5 }), { type: 'start' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status).toBe('running')
  })
})

describe('budget attention', () => {
  it('requires approval for budget decisions', () => {
    expect(attentionFor('waiting_input', 'budget')).toBe('needs_approval')
    expect(canAcceptUserInput('budget')).toBe(false)
    expect(canAcceptUserInput('question')).toBe(true)
  })
})
