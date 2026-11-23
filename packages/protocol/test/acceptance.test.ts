import { describe, expect, it } from 'vitest'
import {
  AcceptanceContract,
  AcceptanceItems,
  AcceptanceReport,
  AcceptanceRun,
  Task,
  TaskSummary,
} from '../src/index.js'

const contract = {
  id: 'ac1',
  taskId: 't1',
  version: 1,
  status: 'draft' as const,
  createdBy: 'verifier' as const,
  revision: 0,
  truncated: false,
  createdAt: 1,
  frozenAt: null,
}

const item = (index: number) => ({
  id: `i${index}`,
  contractId: 'ac1',
  ordinal: index,
  text: `验收项 ${index}`,
  status: 'pending' as const,
  evidence: null,
  source: 'verifier' as const,
  updatedAt: 1,
})

const taskSummary = {
  id: 't1',
  workspaceId: 'w1',
  nodeId: null,
  title: '任务',
  prompt: 'do it',
  status: 'review' as const,
  waitingReason: null,
  engine: 'claude-sdk' as const,
  workspaceMode: 'main' as const,
  branch: null,
  worktreePath: null,
  verifyCommand: null,
  retryCount: 0,
  dangerouslySkipPermissions: false,
  enqueuedAt: null,
  createdAt: 1,
  updatedAt: 2,
  attention: 'needs_review' as const,
  waitingSince: null,
}

describe('acceptance entities', () => {
  it('parses a draft contract', () => {
    expect(AcceptanceContract.parse(contract)).toMatchObject({
      version: 1,
      status: 'draft',
      revision: 0,
    })
  })

  it('accepts 0 items and rejects 9', () => {
    expect(AcceptanceItems.parse([])).toEqual([])
    expect(() => AcceptanceItems.parse(Array.from({ length: 9 }, (_, i) => item(i + 1)))).toThrow()
  })

  it('parses a run with nullable verifier and verdict', () => {
    expect(
      AcceptanceRun.parse({
        id: 'ar1',
        taskId: 't1',
        contractId: 'ac1',
        reviewId: 'r1',
        verifierTaskId: null,
        status: 'running',
        verdict: null,
        summary: null,
        createdAt: 1,
        completedAt: null,
      }),
    ).toMatchObject({ status: 'running', verdict: null })
  })

  it('parses a full report with hash', () => {
    const report = AcceptanceReport.parse({
      taskId: 't1',
      contractId: 'ac1',
      contractVersion: 1,
      contractRevision: 0,
      goal: '登录页',
      result: '未生成',
      changes: { filesChanged: 1, insertions: 2, deletions: 0, files: ['src/login.tsx'] },
      verify: { command: 'pnpm test', exitCode: 0, outputSummary: 'ok', skipped: false },
      acceptance: {
        items: [item(1)],
        counts: { total: 1, pass: 0, fail: 0, pending: 1, waived: 0 },
        verdict: 'incomplete',
      },
      risks: [],
      unverified: ['验收项 1'],
      preliminary: { verdict: null, summary: null },
      hash: 'abc',
    })
    expect(report.acceptance.counts.total).toBe(1)
    expect(report.hash).toBe('abc')
  })
})

describe('task acceptance fields', () => {
  it('defaults TaskSummary acceptance to null', () => {
    const parsed = TaskSummary.parse(taskSummary)
    expect(parsed.acceptance).toBeNull()
  })

  it('rejects a monetary budget field on Task', () => {
    expect(Task.shape).not.toHaveProperty('budgetUsd')
  })
})
