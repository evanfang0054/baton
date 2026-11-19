import { describe, expect, it } from 'vitest'
import { buildVerifierPrompt, parseVerdict } from '../src/supervisor/observe.js'

describe('parseVerdict', () => {
  it('uses the last verdict marker and strips it from the reason', () => {
    const result = parseVerdict('先复述格式 VERDICT: FAIL\n检查通过\nVERDICT: PASS')
    expect(result.verdict).toBe('pass')
    expect(result.reason).not.toContain('VERDICT')
    expect(result.reason).toContain('检查通过')
  })

  it('supports full-width colon and lowercase', () => {
    expect(parseVerdict('结论\nverdict：fail').verdict).toBe('fail')
  })

  it('reports unknown when no marker or no text', () => {
    expect(parseVerdict('看起来不错')).toMatchObject({ verdict: 'unknown' })
    expect(parseVerdict('')).toMatchObject({ verdict: 'unknown' })
  })
})

describe('buildVerifierPrompt', () => {
  it('carries evidence and fixes the verdict format', () => {
    const prompt = buildVerifierPrompt({
      title: '补 README',
      taskId: 't1',
      prompt: '<task>补 README</task>',
      workerOutput: '已补充用法',
      verifyExitCode: 0,
      diffStat: { filesChanged: 1, insertions: 20, deletions: 0 },
    })
    expect(prompt).toContain('补 README')
    expect(prompt).toContain('已补充用法')
    expect(prompt).toContain('1 个文件，+20/-0')
    expect(prompt).toContain('VERDICT: PASS')
    expect(prompt).toContain('不修改文件')
  })
})
