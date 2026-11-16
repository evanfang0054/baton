import { describe, expect, it } from 'vitest'
import { DiffStat, Id, Timestamp } from '../src/common.js'
import { TaskStatus } from '../src/enums.js'
import { AppError } from '../src/errors.js'
import { PolicySchema } from '../src/policy.js'

describe('protocol foundation', () => {
  it('validates ids and timestamps', () => {
    expect(Id.parse('n_1')).toBe('n_1')
    expect(() => Id.parse('')).toThrow()
    expect(Timestamp.parse(0)).toBe(0)
    expect(() => Timestamp.parse(-1)).toThrow()
  })

  it('validates task status', () => {
    expect(TaskStatus.parse('running')).toBe('running')
    expect(() => TaskStatus.parse('paused')).toThrow()
  })

  it('validates diff stat', () => {
    expect(DiffStat.parse({ filesChanged: 1, insertions: 2, deletions: 3 })).toEqual({
      filesChanged: 1,
      insertions: 2,
      deletions: 3,
    })
  })

  it('validates app error', () => {
    expect(AppError.parse({ code: 'x', message: 'y' }).code).toBe('x')
    expect(() => AppError.parse({ code: 'x' })).toThrow()
  })

  it('applies policy defaults', () => {
    const p = PolicySchema.parse({})
    expect(p.verify.timeoutSec).toBe(900)
    expect(p.verify.maxOutputBytes).toBe(262144)
    expect(p.approval.default).toBe('ask')
    expect(p.approval.autoApproveMaxRisk).toBe('low')
    expect(p.autopilot.enabled).toBe(false)
    expect(p.autopilot.retryMax).toBe(2)
    expect(p.autopilot.digestCron).toBe('0 9,21 * * *')
  })

  it('returns fresh default objects per parse', () => {
    const first = PolicySchema.parse({})
    first.approval.allow.push('Mutation')
    const second = PolicySchema.parse({})
    expect(second.approval.allow).not.toContain('Mutation')
  })

  it('rejects invalid policy values', () => {
    expect(() => PolicySchema.parse({ approval: { autoApproveMaxRisk: 'extreme' } })).toThrow()
    expect(() => PolicySchema.parse({ autopilot: { retryMax: -1 } })).toThrow()
  })
})
