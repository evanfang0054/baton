import { describe, expect, it } from 'vitest'
import {
  Attention,
  ClientMessage,
  SESSION_OUTCOME_EVENT,
  SessionOutcome,
  SessionOutcomeValue,
  TaskStatusEvent,
  TaskTransitionEvent,
  WaitingReason,
} from '../src/index.js'

describe('attention protocol', () => {
  it('validates enums', () => {
    expect(SessionOutcome.parse('blocked')).toBe('blocked')
    expect(WaitingReason.parse('question')).toBe('question')
    expect(Attention.parse('needs_reply')).toBe('needs_reply')
    expect(Attention.parse('needs_attention')).toBe('needs_attention')
    expect(() => SessionOutcome.parse('paused')).toThrow()
  })

  it('validates session outcome event', () => {
    expect(SESSION_OUTCOME_EVENT).toBe('session.outcome')
    expect(SessionOutcomeValue.parse({ outcome: 'blocked', reason: 'need a decision' })).toEqual({
      outcome: 'blocked',
      reason: 'need a decision',
    })
    expect(() => SessionOutcomeValue.parse({ outcome: 'blocked', reason: '' })).toThrow()
    expect(() => SessionOutcomeValue.parse({ outcome: 'unreported' })).toThrow()
  })

  it('parses session.reply', () => {
    const message = ClientMessage.parse({
      v: 1,
      id: 'cmd-1',
      ts: 1,
      type: 'session.reply',
      payload: { taskId: 't1', text: 'use option B' },
    })
    expect(message.type).toBe('session.reply')
    expect(() =>
      ClientMessage.parse({
        v: 1,
        id: 'cmd-2',
        ts: 1,
        type: 'session.reply',
        payload: { taskId: 't1', text: '' },
      }),
    ).toThrow()
  })

  it('accepts non-ready session_reported only', () => {
    expect(TaskTransitionEvent.parse({ type: 'session_reported', outcome: 'blocked' }).type).toBe(
      'session_reported',
    )
    expect(() =>
      TaskTransitionEvent.parse({ type: 'session_reported', outcome: 'ready' }),
    ).toThrow()
  })

  it('accepts task.status with and without attention', () => {
    const base = {
      v: 1,
      type: 'task.status',
      ts: 1,
      seq: 1,
      payload: {
        taskId: 't1',
        status: 'waiting_input',
        previousStatus: 'running',
        retryCount: 0,
        updatedAt: 2,
      },
    }
    expect(TaskStatusEvent.parse(base).payload.attention).toBeUndefined()
    expect(
      TaskStatusEvent.parse({
        ...base,
        payload: {
          ...base.payload,
          attention: 'needs_reply',
          cause: { waitingReason: 'question', sessionId: 's1' },
        },
      }).payload.attention,
    ).toBe('needs_reply')
  })
})
