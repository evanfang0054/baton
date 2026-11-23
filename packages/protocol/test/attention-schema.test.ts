import { describe, expect, it } from 'vitest'
import { AttentionItem, DigestAttention } from '../src/attention.js'

describe('attention schemas', () => {
  it('parses an apply_proposal item', () => {
    expect(
      AttentionItem.parse({
        taskId: 't1',
        title: '登录页修复',
        kind: 'failed',
        reason: '任务失败，建议重试',
        waitingSince: 10,
        proposalId: 'a1',
        action: { type: 'apply_proposal', proposalId: 'a1' },
      }),
    ).toMatchObject({ action: { type: 'apply_proposal' } })
  })

  it('parses an empty digest attention block', () => {
    expect(
      DigestAttention.parse({
        items: [],
        counts: { approval: 0, reply: 0, review: 0, failed: 0, stale: 0 },
      }),
    ).toEqual({
      items: [],
      counts: { approval: 0, reply: 0, review: 0, failed: 0, stale: 0 },
    })
  })

  it('ignores the legacy budget count from old digests', () => {
    expect(
      DigestAttention.parse({
        items: [],
        counts: { approval: 1, reply: 0, review: 0, failed: 0, stale: 0, budget: 3 },
      }),
    ).toEqual({
      items: [],
      counts: { approval: 1, reply: 0, review: 0, failed: 0, stale: 0 },
    })
  })

  it('rejects an unknown attention kind', () => {
    expect(
      AttentionItem.safeParse({
        taskId: 't1',
        title: 'x',
        kind: 'running',
        reason: 'x',
        waitingSince: null,
        proposalId: null,
        action: { type: 'open_task' },
      }).success,
    ).toBe(false)
  })
  it('downgrades legacy budget attention items to stale', () => {
    expect(
      DigestAttention.parse({
        items: [
          {
            taskId: 't1',
            title: '旧预算任务',
            kind: 'budget',
            reason: '超出预算',
            waitingSince: 1,
            proposalId: null,
            action: { type: 'open_task' },
          },
        ],
        counts: { approval: 0, reply: 0, review: 0, failed: 0, stale: 0 },
      }).items[0]?.kind,
    ).toBe('stale')
  })
})
