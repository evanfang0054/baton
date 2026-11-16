import { TaskStatus } from '@baton/protocol'
import type { DiffStat, TaskTransitionEvent } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { transition } from '../src/state-machine/index.js'
import type { TaskEffect } from '../src/state-machine/types.js'
import { ctx, expectOk } from './helpers.js'

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

const zeroDiff: DiffStat = { filesChanged: 0, insertions: 0, deletions: 0 }
const oneDiff: DiffStat = { filesChanged: 1, insertions: 1, deletions: 0 }

const EVENTS: TaskTransitionEvent[] = [
  { type: 'enqueue' },
  { type: 'start' },
  { type: 'approval_requested', approvalId: 'a1' },
  { type: 'approval_allow', approvalId: 'a1' },
  { type: 'approval_deny', approvalId: 'a1', note: 'no' },
  { type: 'completed' },
  { type: 'verify_ok', reviewId: 'r1', exitCode: 0, output: 'ok', diffStat: zeroDiff },
  { type: 'verify_fail', reviewId: 'r1', exitCode: 1, output: 'bad', diffStat: oneDiff },
  { type: 'approve', reviewId: 'r1' },
  { type: 'reject', reviewId: 'r1', feedback: 'fix' },
  { type: 'cancel', reason: 'user' },
  { type: 'error', message: 'boom' },
]

const emit = (status: TaskStatus): TaskEffect => ({ type: 'emitTaskStatus', status })

const EXPECTED: Record<string, { status: TaskStatus; effects: TaskEffect[] }> = {
  'todo:enqueue': {
    status: 'queued',
    effects: [{ type: 'enqueueTask' }, emit('queued')],
  },
  'queued:start': {
    status: 'running',
    effects: [{ type: 'startSession' }, emit('running')],
  },
  'running:approval_requested': {
    status: 'waiting_input',
    effects: [{ type: 'requestApproval', approvalId: 'a1' }, emit('waiting_input')],
  },
  'running:completed': {
    status: 'verifying',
    effects: [{ type: 'runVerify' }, emit('verifying')],
  },
  'running:error': {
    status: 'failed',
    effects: [{ type: 'interruptSession', reason: 'boom' }, emit('failed')],
  },
  'waiting_input:approval_allow': {
    status: 'running',
    effects: [{ type: 'resolveApproval', approvalId: 'a1', decision: 'allow' }, emit('running')],
  },
  'waiting_input:approval_deny': {
    status: 'running',
    effects: [
      { type: 'resolveApproval', approvalId: 'a1', decision: 'deny', note: 'no' },
      emit('running'),
    ],
  },
  'waiting_input:error': {
    status: 'failed',
    effects: [{ type: 'interruptSession', reason: 'boom' }, emit('failed')],
  },
  'verifying:verify_ok': {
    status: 'review',
    effects: [
      {
        type: 'persistVerifyResult',
        reviewId: 'r1',
        exitCode: 0,
        output: 'ok',
        diffStat: zeroDiff,
      },
      emit('review'),
    ],
  },
  'verifying:verify_fail': {
    status: 'review',
    effects: [
      {
        type: 'persistVerifyResult',
        reviewId: 'r1',
        exitCode: 1,
        output: 'bad',
        diffStat: oneDiff,
      },
      emit('review'),
    ],
  },
  'review:approve': {
    status: 'done',
    effects: [{ type: 'persistReviewVerdict', reviewId: 'r1', verdict: 'approved' }, emit('done')],
  },
  'review:reject': {
    status: 'queued',
    effects: [
      { type: 'persistReviewVerdict', reviewId: 'r1', verdict: 'rejected' },
      { type: 'appendFeedback', feedback: 'fix' },
      { type: 'enqueueTask' },
      emit('queued'),
    ],
  },
  'todo:cancel': { status: 'cancelled', effects: [emit('cancelled')] },
  'queued:cancel': { status: 'cancelled', effects: [emit('cancelled')] },
  'running:cancel': {
    status: 'cancelled',
    effects: [{ type: 'interruptSession', reason: 'user' }, emit('cancelled')],
  },
  'waiting_input:cancel': {
    status: 'cancelled',
    effects: [{ type: 'interruptSession', reason: 'user' }, emit('cancelled')],
  },
  'verifying:cancel': { status: 'cancelled', effects: [emit('cancelled')] },
  'review:cancel': { status: 'cancelled', effects: [emit('cancelled')] },
}

describe('transition matrix', () => {
  it('matches the protocol status enum', () => {
    expect(STATUSES).toEqual([...TaskStatus.options])
  })

  it('covers 9 statuses x 12 events with exact target and effects', () => {
    expect(STATUSES.length * EVENTS.length).toBe(108)
    for (const status of STATUSES) {
      for (const event of EVENTS) {
        const key = `${status}:${event.type}`
        const result = transition(ctx(status), event)
        const expected = EXPECTED[key]
        if (expected) {
          const ok = expectOk(result)
          expect(ok.status, key).toBe(expected.status)
          expect(ok.effects, key).toEqual(expected.effects)
        } else {
          expect(result.ok, key).toBe(false)
          if (!result.ok) expect(result.error.code, key).toBe('invalid_transition')
        }
      }
    }
  })
})
