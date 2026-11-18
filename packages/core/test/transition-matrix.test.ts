import { TaskStatus } from '@baton/protocol'
import type { DiffStat, TaskStatusCause, TaskTransitionEvent } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { effects } from '../src/state-machine/effects.js'
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
  { type: 'session_reported', outcome: 'blocked', reason: 'need a decision' },
  { type: 'user_input', text: 'use option B' },
  { type: 'verify_ok', reviewId: 'r1', exitCode: 0, output: 'ok', diffStat: zeroDiff },
  { type: 'verify_fail', reviewId: 'r1', exitCode: 1, output: 'bad', diffStat: oneDiff },
  { type: 'approve', reviewId: 'r1' },
  { type: 'reject', reviewId: 'r1', feedback: 'fix' },
  { type: 'cancel', reason: 'user' },
  { type: 'error', message: 'boom' },
]

const emit = (status: TaskStatus, cause?: TaskStatusCause): TaskEffect =>
  effects.emitTaskStatus(status, cause)

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
    effects: [
      { type: 'requestApproval', approvalId: 'a1' },
      emit('waiting_input', { waitingReason: 'approval', approvalId: 'a1' }),
    ],
  },
  'running:session_reported': {
    status: 'waiting_input',
    effects: [
      emit('waiting_input', {
        waitingReason: 'question',
        outcome: 'blocked',
        reason: 'need a decision',
      }),
    ],
  },
  'running:completed': {
    status: 'verifying',
    effects: [{ type: 'runVerify' }, emit('verifying')],
  },
  'running:error': {
    status: 'failed',
    effects: [{ type: 'interruptSession', reason: 'boom' }, emit('failed', { reason: 'boom' })],
  },
  'waiting_input:approval_allow': {
    status: 'running',
    effects: [
      { type: 'resolveApproval', approvalId: 'a1', decision: 'allow' },
      emit('running', { approvalId: 'a1' }),
    ],
  },
  'waiting_input:approval_deny': {
    status: 'running',
    effects: [
      { type: 'resolveApproval', approvalId: 'a1', decision: 'deny', note: 'no' },
      emit('running', { approvalId: 'a1' }),
    ],
  },
  'waiting_input:session_reported': {
    status: 'waiting_input',
    effects: [
      emit('waiting_input', {
        waitingReason: 'question',
        outcome: 'blocked',
        reason: 'need a decision',
      }),
    ],
  },
  'waiting_input:error': {
    status: 'failed',
    effects: [{ type: 'interruptSession', reason: 'boom' }, emit('failed', { reason: 'boom' })],
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
      emit('review', { reviewId: 'r1' }),
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
      emit('review', { reviewId: 'r1' }),
    ],
  },
  'review:approve': {
    status: 'done',
    effects: [
      { type: 'persistReviewVerdict', reviewId: 'r1', verdict: 'approved' },
      emit('done', { reviewId: 'r1' }),
    ],
  },
  'review:reject': {
    status: 'queued',
    effects: [
      { type: 'persistReviewVerdict', reviewId: 'r1', verdict: 'rejected' },
      { type: 'appendFeedback', feedback: 'fix' },
      { type: 'enqueueTask' },
      emit('queued', { reviewId: 'r1' }),
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

  it('covers 9 statuses x 14 events with exact target and effects', () => {
    expect(STATUSES.length * EVENTS.length).toBe(126)
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
