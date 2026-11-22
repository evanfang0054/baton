import { describe, expect, it } from 'vitest'
import { buildAttentionItems } from '../src/supervisor/attention.js'

const now = 10_000_000

describe('buildAttentionItems', () => {
  it('keeps one item per task by highest priority and counts exactly the list', () => {
    const result = buildAttentionItems({
      now,
      tasks: [
        {
          taskId: 't1',
          title: '待审批',
          status: 'waiting_input',
          attention: 'needs_approval',
          waitingReason: 'approval',
          waitingSince: now - 60_000,
          updatedAt: now - 60_000,
          acceptance: null,
          budget: null,
          proposalId: null,
          lastFailure: null,
        },
        {
          taskId: 't1',
          title: '待审批',
          status: 'waiting_input',
          attention: 'needs_approval',
          waitingReason: 'approval',
          waitingSince: now - 60_000,
          updatedAt: now - 60_000,
          acceptance: null,
          budget: { overBudget: true },
          proposalId: null,
          lastFailure: null,
        },
        {
          taskId: 't2',
          title: '失败',
          status: 'failed',
          attention: 'none',
          waitingReason: null,
          waitingSince: null,
          updatedAt: now - 10_000,
          acceptance: null,
          budget: null,
          proposalId: 'a2',
          lastFailure: { stage: 'run', summary: '进程退出 1' },
        },
      ],
    })
    expect(result.items.map((item) => [item.taskId, item.kind])).toEqual([
      ['t1', 'approval'],
      ['t2', 'failed'],
    ])
    expect(result.items[1]?.action).toEqual({ type: 'apply_proposal', proposalId: 'a2' })
    expect(result.counts.approval).toBe(1)
    expect(result.counts.failed).toBe(1)
    expect(Object.values(result.counts).reduce((sum, value) => sum + value, 0)).toBe(
      result.items.length,
    )
  })

  it('uses open_review for review and open_task for approve/cancel', () => {
    const result = buildAttentionItems({
      now,
      tasks: [
        {
          taskId: 't1',
          title: '待验收',
          status: 'review',
          attention: 'needs_review',
          waitingReason: null,
          waitingSince: now - 1,
          updatedAt: now - 1,
          acceptance: null,
          budget: null,
          proposalId: null,
          lastFailure: null,
        },
      ],
    })
    expect(result.items[0]?.action).toEqual({ type: 'open_review' })
  })

  it('keeps reply ahead of stale', () => {
    const result = buildAttentionItems({
      now,
      tasks: [
        {
          taskId: 't1',
          title: '陈旧',
          status: 'waiting_input',
          attention: 'none',
          waitingReason: 'question',
          waitingSince: now - 31 * 60_000,
          updatedAt: now - 31 * 60_000,
          acceptance: null,
          budget: null,
          proposalId: null,
          lastFailure: null,
        },
      ],
    })
    expect(result.items[0]?.kind).toBe('reply')
  })

  it('caps at 20 and drops silence', () => {
    const tasks = Array.from({ length: 25 }, (_, index) => ({
      taskId: `t${index}`,
      title: `任务 ${index}`,
      status: 'review' as const,
      attention: 'needs_review' as const,
      waitingReason: null,
      waitingSince: now - index,
      updatedAt: now - index,
      acceptance: null,
      budget: null,
      proposalId: null,
      lastFailure: null,
    }))
    const result = buildAttentionItems({ now, tasks })
    expect(result.items).toHaveLength(20)
    expect(Object.values(result.counts).reduce((sum, value) => sum + value, 0)).toBe(20)
    expect(buildAttentionItems({ now, tasks: [] })).toEqual({
      items: [],
      counts: { approval: 0, reply: 0, review: 0, failed: 0, budget: 0, stale: 0 },
    })
  })
})
