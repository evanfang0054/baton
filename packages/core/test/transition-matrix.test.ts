import type { TaskStatus, TaskTransitionEvent } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { transition } from '../src/state-machine/index.js'
import type { TransitionContext } from '../src/state-machine/types.js'

const STATUSES: TaskStatus[] = [
  'todo',
  'queued',
  'running',
  'waiting_input',
  'verifying',
  'review',
  'done',
  'failed',
  'cancelled',
]

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

const VALID = new Set([
  'todo:enqueue',
  'queued:start',
  'running:approval_requested',
  'running:completed',
  'running:error',
  'waiting_input:approval_allow',
  'waiting_input:approval_deny',
  'waiting_input:error',
  'verifying:verify_ok',
  'verifying:verify_fail',
  'review:approve',
  'review:reject',
  'todo:cancel',
  'queued:cancel',
  'running:cancel',
  'waiting_input:cancel',
  'verifying:cancel',
  'review:cancel',
])

const ctx = (status: TaskStatus): TransitionContext => ({
  status,
  retryCount: 0,
  runningCount: 0,
  maxConcurrency: 1,
  autopilot: { enabled: false, retryMax: 2 },
})

describe('transition matrix', () => {
  it('covers 9 statuses x 12 events', () => {
    expect(STATUSES.length * EVENTS.length).toBe(108)
    for (const status of STATUSES) {
      for (const event of EVENTS) {
        const result = transition(ctx(status), event)
        const key = `${status}:${event.type}`
        if (VALID.has(key)) {
          expect(result.ok, key).toBe(true)
          if (result.ok) {
            expect(
              result.effects.filter((effect) => effect.type === 'emitTaskStatus'),
              key,
            ).toHaveLength(1)
          }
        } else {
          expect(result.ok, key).toBe(false)
          if (!result.ok) expect(result.error.code).toBe('invalid_transition')
        }
      }
    }
  })
})
