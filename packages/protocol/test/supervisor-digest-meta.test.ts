import { describe, expect, it } from 'vitest'
import { SupervisorMessage } from '../src/supervisor.js'

const base = {
  id: 'm1',
  threadId: 'th1',
  role: 'assistant' as const,
  content: '本轮汇报',
  toolCalls: [],
  decision: null,
  status: 'ok' as const,
  error: null,
  createdAt: 1,
}

describe('supervisor digest message meta', () => {
  it('keeps old messages without digest parseable', () => {
    const parsed = SupervisorMessage.parse({
      ...base,
      meta: { contextNodeIds: ['n1'], targetNodeId: 'a1' },
    })
    expect(parsed.meta?.digest).toBeNull()
  })

  it('parses a digest snapshot with attention items', () => {
    const parsed = SupervisorMessage.parse({
      ...base,
      meta: {
        contextNodeIds: [],
        targetNodeId: null,
        digest: {
          noticeId: 'n1',
          trigger: 'schedule',
          generatedAt: 2,
          items: [
            {
              taskId: 't1',
              title: '登录页修复',
              kind: 'review',
              reason: '等待你验收',
              waitingSince: 3,
              proposalId: null,
              action: { type: 'open_review' },
            },
          ],
        },
      },
    })
    expect(parsed.meta?.digest?.trigger).toBe('schedule')
    expect(parsed.meta?.digest?.items[0]?.action).toEqual({ type: 'open_review' })
  })
})
