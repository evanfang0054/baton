import { describe, expect, it } from 'vitest'
import {
  AcceptanceUpdatedEvent,
  ClientMessage,
  ContextInjectInput,
  ReviewDecideInput,
  TaskTransitionEvent,
} from '../src/index.js'

describe('acceptance commands', () => {
  it('parses acceptance.update with 0-8 items', () => {
    const parsed = ClientMessage.parse({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'acceptance.update',
      payload: {
        taskId: 't1',
        contractId: 'ac1',
        expectedRevision: 0,
        items: [{ text: '登录成功', status: 'pending' }],
      },
    })
    expect(parsed.type).toBe('acceptance.update')
  })

  it('rejects acceptance.update with 9 items', () => {
    expect(() =>
      ClientMessage.parse({
        v: 1,
        id: 'c2',
        ts: 1,
        type: 'acceptance.update',
        payload: {
          taskId: 't1',
          contractId: 'ac1',
          expectedRevision: 0,
          items: Array.from({ length: 9 }, () => ({ text: 'x', status: 'pending' })),
        },
      }),
    ).toThrow()
  })

  it('rejects task.set_budget as an unknown command', () => {
    expect(
      ClientMessage.safeParse({
        v: 1,
        id: 'c3',
        ts: 1,
        type: 'task.set_budget',
        payload: { taskId: 't1', budgetUsd: 3 },
      }).success,
    ).toBe(false)
  })
})

describe('review override', () => {
  it('accepts overrideReason on approve', () => {
    expect(
      ReviewDecideInput.parse({
        reviewId: 'r1',
        decision: 'approve',
        overrideReason: '已知风险',
      }),
    ).toMatchObject({ decision: 'approve', overrideReason: '已知风险' })
  })

  it('still requires feedback or context on reject', () => {
    expect(() => ReviewDecideInput.parse({ reviewId: 'r1', decision: 'reject' })).toThrow()
  })
})

describe('context inject requestId', () => {
  it('accepts requestId', () => {
    expect(
      ContextInjectInput.parse({ taskId: 't1', nodeIds: ['n1'], requestId: 'req-1' }),
    ).toMatchObject({ requestId: 'req-1' })
  })
})

describe('removed budget transitions', () => {
  it('rejects budget_exceeded and budget_raise', () => {
    expect(TaskTransitionEvent.safeParse({ type: 'budget_exceeded' }).success).toBe(false)
    expect(TaskTransitionEvent.safeParse({ type: 'budget_raise', budgetUsd: 3 }).success).toBe(
      false,
    )
  })
})

describe('acceptance.updated event', () => {
  it('parses counts and verdict without item text', () => {
    const parsed = AcceptanceUpdatedEvent.parse({
      v: 1,
      ts: 1,
      seq: 1,
      type: 'acceptance.updated',
      payload: {
        taskId: 't1',
        contractId: 'ac1',
        version: 1,
        revision: 0,
        status: 'draft',
        counts: { total: 3, pass: 2, fail: 1, pending: 0, waived: 0 },
        verdict: 'fail',
      },
    })
    expect(parsed.payload.counts.fail).toBe(1)
    expect(JSON.stringify(parsed)).not.toContain('验收项')
  })
})
