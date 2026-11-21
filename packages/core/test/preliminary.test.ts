import { describe, expect, it } from 'vitest'
import { parsePreliminaryVerdict } from '../src/review/preliminary.js'

describe('parsePreliminaryVerdict', () => {
  it('uses the last verdict line', () => {
    expect(parsePreliminaryVerdict('VERDICT: FAIL\n理由\nVERDICT: PASS').verdict).toBe('pass')
  })

  it('keeps only a short reason', () => {
    const parsed = parsePreliminaryVerdict('第一行\n第二行\nVERDICT: FAIL')
    expect(parsed.verdict).toBe('fail')
    expect(parsed.reason).toBe('第一行\n第二行')
  })

  it('falls back to outcome reason only for clear words', () => {
    expect(parsePreliminaryVerdict('', '满足要求，已完成').verdict).toBe('pass')
    expect(parsePreliminaryVerdict('', '不满足要求，需要修改').verdict).toBe('fail')
    expect(parsePreliminaryVerdict('', '看情况').verdict).toBe('unknown')
  })

  it('returns unknown when there is no evidence', () => {
    expect(parsePreliminaryVerdict('', null)).toEqual({
      verdict: 'unknown',
      reason: '验收员没有返回文本结论',
    })
  })
})
