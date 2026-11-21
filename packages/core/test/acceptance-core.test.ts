import { describe, expect, it } from 'vitest'
import { acceptanceSummary, cloneAcceptanceItems, validateAcceptanceUpdate } from '../src/index.js'

describe('acceptanceSummary', () => {
  it('passes when all non-waived items pass', () => {
    expect(acceptanceSummary([{ status: 'pass' }, { status: 'waived' }])).toEqual({
      counts: { total: 2, pass: 1, fail: 0, pending: 0, waived: 1 },
      verdict: 'pass',
    })
  })

  it('fails if any item fails', () => {
    expect(acceptanceSummary([{ status: 'pass' }, { status: 'fail' }]).verdict).toBe('fail')
  })

  it('is incomplete with pending or empty', () => {
    expect(acceptanceSummary([{ status: 'pass' }, { status: 'pending' }]).verdict).toBe(
      'incomplete',
    )
    expect(acceptanceSummary([]).verdict).toBe('incomplete')
  })
})

describe('validateAcceptanceUpdate', () => {
  it('accepts 0-8 valid items', () => {
    expect(
      validateAcceptanceUpdate({ items: [], expectedRevision: 0, currentRevision: 0 }),
    ).toEqual({ ok: true })
    expect(
      validateAcceptanceUpdate({
        items: [{ text: '登录成功', status: 'pending' }],
        expectedRevision: 1,
        currentRevision: 1,
      }),
    ).toEqual({ ok: true })
  })

  it('rejects revision mismatch', () => {
    expect(
      validateAcceptanceUpdate({ items: [], expectedRevision: 1, currentRevision: 2 }),
    ).toMatchObject({ ok: false, code: 'revision_conflict' })
  })

  it('rejects 9 items', () => {
    expect(
      validateAcceptanceUpdate({
        items: Array.from({ length: 9 }, () => ({ text: 'x', status: 'pending' as const })),
        expectedRevision: 0,
        currentRevision: 0,
      }),
    ).toMatchObject({ ok: false, code: 'too_many_items' })
  })

  it('rejects long text/evidence and invalid status', () => {
    expect(
      validateAcceptanceUpdate({
        items: [{ text: 'x'.repeat(201), status: 'pending' }],
        expectedRevision: 0,
        currentRevision: 0,
      }),
    ).toMatchObject({ ok: false, code: 'text_too_long', index: 0 })
    expect(
      validateAcceptanceUpdate({
        items: [{ text: 'x', status: 'pending', evidence: 'e'.repeat(201) }],
        expectedRevision: 0,
        currentRevision: 0,
      }),
    ).toMatchObject({ ok: false, code: 'evidence_too_long', index: 0 })
    expect(
      validateAcceptanceUpdate({
        items: [{ text: 'x', status: 'done' as never }],
        expectedRevision: 0,
        currentRevision: 0,
      }),
    ).toMatchObject({ ok: false, code: 'invalid_status', index: 0 })
  })
})

describe('cloneAcceptanceItems', () => {
  it('keeps text and resets status/evidence/source', () => {
    expect(cloneAcceptanceItems([{ text: '登录成功' }, { text: '错误提示' }])).toEqual([
      { ordinal: 1, text: '登录成功', status: 'pending', evidence: null, source: 'verifier' },
      { ordinal: 2, text: '错误提示', status: 'pending', evidence: null, source: 'verifier' },
    ])
  })
})
