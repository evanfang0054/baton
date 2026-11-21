import { describe, expect, it } from 'vitest'
import { buildVerifierPrompt, parseVerdict } from '../src/supervisor/observe.js'
import { parseAcceptanceReport } from '../src/supervisor/acceptance-parse.js'

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

  it('falls back to the session outcome reason when the model omits VERDICT', () => {
    expect(
      parseVerdict('改动核验完成，满足原始要求', 'README.md 末尾已正确添加目标行，满足任务要求'),
    ).toMatchObject({ verdict: 'pass' })
    expect(parseVerdict('', '未满足原始要求，需要修改')).toMatchObject({ verdict: 'fail' })
    expect(parseVerdict('', '无法确认改动')).toMatchObject({ verdict: 'fail' })
  })

  it('prefers an explicit VERDICT over the outcome reason', () => {
    expect(parseVerdict('VERDICT: FAIL', '整体满足要求，但存在边界问题')).toMatchObject({
      verdict: 'fail',
    })
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
    expect(prompt).toContain('<acceptance_report>')
    expect(prompt).toContain('<verifier_task>')
    expect(prompt).toContain('不修改文件')
  })
})

describe('parseAcceptanceReport', () => {
  it('parses the last block and normalizes items', () => {
    const parsed = parseAcceptanceReport(`
      先复述 <acceptance_report>{"verdict":"pass"}</acceptance_report>
      <acceptance_report>{"verdict":"fail","summary":"1 条未过","items":[
        {"text":"登录成功","status":"pass","evidence":"src/login.tsx:1"},
        {"text":"错误提示","status":"fail"}
      ]}</acceptance_report>`)
    expect(parsed).toMatchObject({
      verdict: 'fail',
      summary: '1 条未过',
      items: [
        { text: '登录成功', status: 'pass', evidence: 'src/login.tsx:1' },
        { text: '错误提示', status: 'fail', evidence: null },
      ],
    })
  })

  it('supports a fenced json block and caps items/lengths', () => {
    const items = Array.from({ length: 9 }, (_, index) => ({
      text: `${index}-${'x'.repeat(300)}`,
      status: 'pending',
      evidence: 'e'.repeat(300),
    }))
    const parsed = parseAcceptanceReport(
      '```json\n' + JSON.stringify({ verdict: 'incomplete', items }) + '\n```',
    )
    expect(parsed?.items).toHaveLength(8)
    expect(parsed?.items[0]?.text).toHaveLength(200)
    expect(parsed?.items[0]?.evidence).toHaveLength(200)
  })

  it('returns null on missing or malformed JSON', () => {
    expect(parseAcceptanceReport('没有结构化结果')).toBeNull()
    expect(parseAcceptanceReport('<acceptance_report>{bad}</acceptance_report>')).toBeNull()
    expect(
      parseAcceptanceReport('<acceptance_report>{"verdict":"maybe"}</acceptance_report>'),
    ).toBeNull()
  })
})
