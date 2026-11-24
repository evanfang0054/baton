import { describe, expect, it } from 'vitest'
import {
  canCancelDeliveryStatus,
  deriveCurrentStageKey,
  deriveDeliveryStatus,
  deriveStageStatus,
} from '../src/delivery/status.js'

describe('deriveStageStatus', () => {
  it.each([
    [null, 'pending'],
    ['todo', 'pending'],
    ['queued', 'running'],
    ['running', 'running'],
    ['verifying', 'running'],
    ['waiting_input', 'waiting_person'],
    ['review', 'waiting_person'],
    ['done', 'done'],
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
  ] as const)('%s -> %s', (taskStatus, expected) => {
    expect(deriveStageStatus(taskStatus)).toBe(expected)
  })
})

describe('deriveDeliveryStatus', () => {
  const stages = (
    ...statuses: Array<'pending' | 'running' | 'waiting_person' | 'done' | 'failed' | 'cancelled'>
  ) => statuses.map((status, index) => ({ key: `s${index}`, status }))

  it('derives the priority order', () => {
    expect(deriveDeliveryStatus({ cancelled: true, stages: stages('done') })).toBe('cancelled')
    expect(deriveDeliveryStatus({ cancelled: false, stages: stages('done', 'done') })).toBe('done')
    expect(
      deriveDeliveryStatus({ cancelled: false, stages: stages('done', 'waiting_person') }),
    ).toBe('waiting_person')
    expect(deriveDeliveryStatus({ cancelled: false, stages: stages('done', 'pending') })).toBe(
      'waiting_person',
    )
    expect(deriveDeliveryStatus({ cancelled: false, stages: stages('running', 'pending') })).toBe(
      'running',
    )
    expect(deriveDeliveryStatus({ cancelled: false, stages: stages('failed', 'pending') })).toBe(
      'blocked',
    )
    expect(
      deriveDeliveryStatus({ cancelled: false, stages: stages('done', 'cancelled', 'pending') }),
    ).toBe('cancelled')
    expect(deriveDeliveryStatus({ cancelled: false, stages: stages('pending', 'pending') })).toBe(
      'draft',
    )
  })

  it('derives the current stage and skips done/cancelled', () => {
    expect(deriveCurrentStageKey(stages('done', 'running', 'pending'))).toBe('s1')
    expect(deriveCurrentStageKey(stages('done', 'done'))).toBeNull()
    expect(deriveCurrentStageKey(stages('done', 'cancelled', 'pending'))).toBeNull()
  })
})

describe('canCancelDeliveryStatus', () => {
  it('rejects terminal delivery states', () => {
    expect(canCancelDeliveryStatus('draft')).toBe(true)
    expect(canCancelDeliveryStatus('running')).toBe(true)
    expect(canCancelDeliveryStatus('waiting_person')).toBe(true)
    expect(canCancelDeliveryStatus('blocked')).toBe(true)
    expect(canCancelDeliveryStatus('done')).toBe(false)
    expect(canCancelDeliveryStatus('cancelled')).toBe(false)
  })
})
