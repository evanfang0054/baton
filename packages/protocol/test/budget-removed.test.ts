import { describe, expect, it } from 'vitest'
import { AcceptanceReportFacts, Task, WaitingReason } from '../src/index.js'
import { AttentionCounts, AttentionKind } from '../src/attention.js'
import { TaskSummary } from '../src/api.js'

describe('monetary budget removal', () => {
  it('removes budget enum members and fields', () => {
    expect(WaitingReason.safeParse('budget').success).toBe(false)
    expect(AttentionKind.safeParse('budget').success).toBe(false)
    expect(Object.keys(Task.shape)).not.toContain('budgetUsd')
    expect(Object.keys(TaskSummary.shape)).not.toContain('budget')
    expect(Object.keys(AttentionCounts.shape)).not.toContain('budget')
    expect(Object.keys(AcceptanceReportFacts.shape)).not.toContain('budget')
    expect(Object.keys(AcceptanceReportFacts.shape)).not.toContain('usage')
  })
})
