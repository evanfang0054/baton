import { describe, expect, it } from 'vitest'
import { VERIFY_SKIPPED } from '@baton/protocol'
import { buildAcceptanceReport } from '../src/index.js'
import { stableStringify } from '../src/policy/match.js'

const item = (
  ordinal: number,
  text: string,
  status: 'pending' | 'pass' | 'fail' | 'waived',
  evidence: string | null = null,
) => ({
  id: `i${ordinal}`,
  contractId: 'ac1',
  ordinal,
  text,
  status,
  evidence,
  source: 'verifier' as const,
  updatedAt: 1,
})

const budget = {
  budgetUsd: 2,
  spentUsd: 1.7,
  remainingUsd: 0.3,
  ratio: 0.85,
  overBudget: false,
  nearBudget: true,
  workerCostUsd: 1.7,
  verifierCostUsd: 0.08,
  turns: 3,
}

const input = {
  task: { id: 't1', title: '登录页', workspaceMode: 'worktree' as const, worktreePath: '/tmp/w' },
  contract: { id: 'ac1', version: 2, revision: 1 },
  items: [
    item(1, '登录成功', 'pass', 'src/login.tsx:42'),
    item(2, '错误提示', 'pass', 'test/login.test.ts'),
    item(3, '深链参数校验', 'fail', 'src/login.tsx:88'),
    item(4, '记住我', 'pending'),
  ],
  run: { status: 'complete' as const, verdict: 'fail' as const, summary: '2 条未过' },
  review: {
    verifyExitCode: 1,
    verifyOutput: 'FAIL /workspace/demo/test/login.test.ts',
    diffStat: { filesChanged: 2, insertions: 8, deletions: 1 },
    preliminaryReason: null,
  },
  changedFiles: ['/workspace/demo/src/login.tsx', '/external/secret.ts', 'src/app.tsx'],
  worker: { costUsd: 1.7, turns: 3 },
  verifier: { costUsd: 0.08, turns: 1 },
  budget,
  verifyCommand: 'pnpm test',
  workspaceRoot: '/workspace/demo',
}

describe('buildAcceptanceReport', () => {
  it('derives a report without diff body or transcript', () => {
    const { report, canonical } = buildAcceptanceReport(input)
    expect(report.acceptance.counts).toEqual({
      total: 4,
      pass: 2,
      fail: 1,
      pending: 1,
      waived: 0,
    })
    expect(report.acceptance.verdict).toBe('fail')
    expect(report.result).toBe('2 条未过')
    expect(report.changes.files).toEqual(['src/login.tsx', '<external>', 'src/app.tsx'])
    expect(report.verify.outputSummary).toContain('<workspace>')
    expect(report.verify.outputSummary).not.toContain('/workspace/demo')
    expect(report.risks).toEqual(
      expect.arrayContaining([
        '1 条验收未通过',
        '1 条验收未完成',
        '预算接近上限',
        '在 worktree 中执行',
      ]),
    )
    expect(report.unverified).toEqual(expect.arrayContaining(['深链参数校验', '记住我']))
    expect(JSON.stringify(report)).not.toContain('diff --git')
    expect(canonical).toBe(stableStringify(report))
  })

  it('marks skipped verify and failure without AC', () => {
    const { report } = buildAcceptanceReport({
      ...input,
      items: [],
      run: { status: 'failed' as const, verdict: 'incomplete' as const, summary: null },
      review: {
        verifyExitCode: VERIFY_SKIPPED,
        verifyOutput: '',
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        preliminaryReason: null,
      },
    })
    expect(report.acceptance.verdict).toBe('incomplete')
    expect(report.verify.skipped).toBe(true)
    expect(report.risks).toEqual(expect.arrayContaining(['未执行自动校验', '初步验收未完成']))
    expect(report.unverified).toContain('自动校验未执行')
  })
})
