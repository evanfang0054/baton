import type { AcceptanceReport } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AcceptanceReport as AcceptanceReportView } from './AcceptanceReport'

const report: AcceptanceReport = {
  taskId: 't1',
  contractId: 'ac1',
  contractVersion: 1,
  contractRevision: 2,
  goal: '登录页修复',
  result: '完成登录与错误提示',
  changes: {
    filesChanged: 2,
    insertions: 8,
    deletions: 1,
    files: ['src/login.tsx', 'test/login.test.ts'],
  },
  verify: { command: 'pnpm test', exitCode: 0, outputSummary: 'ok', skipped: false },
  acceptance: {
    items: [
      {
        id: 'i1',
        contractId: 'ac1',
        ordinal: 1,
        text: '登录成功',
        status: 'pass',
        evidence: 'src/login.tsx:1',
        source: 'verifier',
        updatedAt: 1,
      },
      {
        id: 'i2',
        contractId: 'ac1',
        ordinal: 2,
        text: '错误提示',
        status: 'fail',
        evidence: 'test/login.test.ts',
        source: 'verifier',
        updatedAt: 1,
      },
    ],
    counts: { total: 2, pass: 1, fail: 1, pending: 0, waived: 0 },
    verdict: 'fail',
  },
  usage: {
    workerCostUsd: 1.2,
    verifierCostUsd: 0.1,
    turns: 4,
    budgetUsd: 2,
    spentUsd: 1.2,
    remainingUsd: 0.8,
    overBudget: false,
    nearBudget: false,
  },
  risks: ['1 条验收未通过'],
  unverified: ['错误提示'],
  preliminary: { verdict: 'fail', summary: '1 条未过' },
  hash: 'a'.repeat(64),
}

describe('AcceptanceReport', () => {
  it('renders report sections without diff body', () => {
    render(<AcceptanceReportView report={report} />)
    expect(screen.getByText('改动')).toBeInTheDocument()
    expect(screen.getByText('校验')).toBeInTheDocument()
    expect(screen.getByText('成本')).toBeInTheDocument()
    expect(screen.getByText('风险与未验证')).toBeInTheDocument()
    expect(screen.getAllByText(/错误提示/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/diff --git/)).toBeNull()
  })
})
