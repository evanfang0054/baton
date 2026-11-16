import type { TaskStatus, TaskTransitionEvent } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { transition } from '../src/state-machine/index.js'
import { ctx, expectOk } from './helpers.js'

const TERMINAL: TaskStatus[] = ['done', 'failed', 'cancelled']

const EVENTS: TaskTransitionEvent[] = [
  { type: 'enqueue' },
  { type: 'start' },
  { type: 'approval_requested', approvalId: 'a1' },
  { type: 'approval_allow', approvalId: 'a1' },
  { type: 'approval_deny', approvalId: 'a1', note: 'no' },
  { type: 'completed' },
  {
    type: 'verify_ok',
    reviewId: 'r1',
    exitCode: 0,
    output: 'ok',
    diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
  },
  {
    type: 'verify_fail',
    reviewId: 'r1',
    exitCode: 1,
    output: 'bad',
    diffStat: { filesChanged: 1, insertions: 1, deletions: 0 },
  },
  { type: 'approve', reviewId: 'r1' },
  { type: 'reject', reviewId: 'r1', feedback: 'fix' },
  { type: 'cancel', reason: 'user' },
  { type: 'error', message: 'boom' },
]

describe('terminal states', () => {
  it('rejects every event from terminal states', () => {
    for (const status of TERMINAL) {
      for (const event of EVENTS) {
        const result = transition(ctx(status), event)
        expect(result.ok, `${status}:${event.type}`).toBe(false)
        if (!result.ok) expect(result.error.code).toBe('invalid_transition')
      }
    }
  })

  it('cancel from review has no interruptSession', () => {
    const result = expectOk(transition(ctx('review'), { type: 'cancel' }))
    expect(result.status).toBe('cancelled')
    expect(result.effects).not.toContainEqual({ type: 'interruptSession' })
  })

  it('cancel from running interrupts the session', () => {
    const result = expectOk(transition(ctx('running'), { type: 'cancel' }))
    expect(result.status).toBe('cancelled')
    expect(result.effects).toContainEqual({ type: 'interruptSession' })
  })

  it('cancel from verifying does not interrupt the ended agent session', () => {
    const result = expectOk(transition(ctx('verifying'), { type: 'cancel' }))
    expect(result.status).toBe('cancelled')
    expect(result.effects).not.toContainEqual({ type: 'interruptSession' })
  })

  it('cancel from todo has no interruptSession', () => {
    const result = expectOk(transition(ctx('todo'), { type: 'cancel' }))
    expect(result.status).toBe('cancelled')
    expect(result.effects).not.toContainEqual({ type: 'interruptSession' })
  })
})
