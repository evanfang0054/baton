import type { TaskStatus } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { transition } from '../src/state-machine/index.js'
import type { TransitionContext } from '../src/state-machine/types.js'

const ctx = (
  status: TaskStatus,
  overrides: Partial<TransitionContext> = {},
): TransitionContext => ({
  status,
  retryCount: 0,
  runningCount: 0,
  maxConcurrency: 1,
  autopilot: { enabled: false, retryMax: 2 },
  ...overrides,
})

describe('transition happy path', () => {
  it('moves todo to queued', () => {
    const result = transition(ctx('todo'), { type: 'enqueue' })
    expect(result).toMatchObject({ ok: true, status: 'queued' })
    expect(result.ok && result.effects).toContainEqual({ type: 'enqueueTask' })
  })

  it('moves queued to running when a slot is free', () => {
    const result = transition(ctx('queued'), { type: 'start' })
    expect(result).toMatchObject({ ok: true, status: 'running' })
    expect(result.ok && result.effects).toContainEqual({ type: 'startSession' })
  })

  it('moves running to waiting_input and back', () => {
    const waiting = transition(ctx('running'), { type: 'approval_requested', approvalId: 'a1' })
    expect(waiting).toMatchObject({ ok: true, status: 'waiting_input' })

    const allowed = transition(ctx('waiting_input'), { type: 'approval_allow', approvalId: 'a1' })
    expect(allowed).toMatchObject({ ok: true, status: 'running' })
    expect(allowed.ok && allowed.effects).toContainEqual({
      type: 'resolveApproval',
      approvalId: 'a1',
      decision: 'allow',
    })
  })

  it('moves running to verifying on completion', () => {
    const result = transition(ctx('running'), { type: 'completed' })
    expect(result).toMatchObject({ ok: true, status: 'verifying' })
    expect(result.ok && result.effects).toContainEqual({ type: 'runVerify' })
  })

  it('moves running and waiting_input to failed on error', () => {
    expect(transition(ctx('running'), { type: 'error', message: 'boom' })).toMatchObject({
      ok: true,
      status: 'failed',
    })
    expect(transition(ctx('waiting_input'), { type: 'error', message: 'boom' })).toMatchObject({
      ok: true,
      status: 'failed',
    })
  })
})
