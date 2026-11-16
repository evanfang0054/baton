import { describe, expect, it } from 'vitest'
import { transition } from '../src/state-machine/index.js'
import { ctx, expectOk } from './helpers.js'

describe('transition happy path', () => {
  it('moves todo to queued', () => {
    const result = expectOk(transition(ctx('todo'), { type: 'enqueue' }))
    expect(result.status).toBe('queued')
    expect(result.effects).toContainEqual({ type: 'enqueueTask' })
  })

  it('moves queued to running when a slot is free', () => {
    const result = expectOk(transition(ctx('queued'), { type: 'start' }))
    expect(result.status).toBe('running')
    expect(result.effects).toContainEqual({ type: 'startSession' })
  })

  it('moves running to waiting_input and back', () => {
    const waiting = expectOk(
      transition(ctx('running'), { type: 'approval_requested', approvalId: 'a1' }),
    )
    expect(waiting.status).toBe('waiting_input')
    expect(waiting.effects).toContainEqual({ type: 'requestApproval', approvalId: 'a1' })

    const allowed = expectOk(
      transition(ctx('waiting_input'), { type: 'approval_allow', approvalId: 'a1' }),
    )
    expect(allowed.status).toBe('running')
    expect(allowed.effects).toContainEqual({
      type: 'resolveApproval',
      approvalId: 'a1',
      decision: 'allow',
    })

    const denied = expectOk(
      transition(ctx('waiting_input'), {
        type: 'approval_deny',
        approvalId: 'a1',
        note: 'use soft delete',
      }),
    )
    expect(denied.status).toBe('running')
    expect(denied.effects).toContainEqual({
      type: 'resolveApproval',
      approvalId: 'a1',
      decision: 'deny',
      note: 'use soft delete',
    })
  })

  it('moves running to verifying on completion', () => {
    const result = expectOk(transition(ctx('running'), { type: 'completed' }))
    expect(result.status).toBe('verifying')
    expect(result.effects).toContainEqual({ type: 'runVerify' })
  })

  it('moves running and waiting_input to failed on error', () => {
    const running = expectOk(transition(ctx('running'), { type: 'error', message: 'boom' }))
    expect(running.status).toBe('failed')
    expect(running.effects).toContainEqual({ type: 'interruptSession', reason: 'boom' })

    const waiting = expectOk(transition(ctx('waiting_input'), { type: 'error', message: 'boom' }))
    expect(waiting.status).toBe('failed')
    expect(waiting.effects).toContainEqual({ type: 'interruptSession', reason: 'boom' })
  })
})
