import { describe, expect, it } from 'vitest'
import type { Task } from '@baton/protocol'
import { buildDigest } from '../src/index.js'

const base = {
  id: 't1',
  workspaceId: 'w1',
  nodeId: 'n1',
  title: '修复登录',
  prompt: 'SECRET_PROMPT',
  status: 'review',
  waitingReason: null,
  engine: 'fake',
  workspaceMode: 'main',
  branch: null,
  worktreePath: null,
  verifyCommand: null,
  retryCount: 1,
  dangerouslySkipPermissions: false,
  budgetUsd: null,
  enqueuedAt: null,
  createdAt: 10,
  updatedAt: 90,
} satisfies Task

describe('buildDigest', () => {
  it('summarizes ready, blocked, dropped and changes without prompt', () => {
    const digest = buildDigest({
      workspaceId: 'w1',
      now: 100,
      windowStart: 50,
      policyVersion: 'abc123abc123',
      tasks: [
        base,
        {
          ...base,
          id: 't2',
          title: '等待审批',
          status: 'waiting_input',
          waitingReason: 'approval',
          updatedAt: 80,
        },
        {
          ...base,
          id: 't3',
          title: '已放弃',
          status: 'waiting_input',
          waitingReason: 'dropped',
          updatedAt: 70,
        },
        { ...base, id: 't4', title: '进行中', status: 'running', updatedAt: 60 },
      ],
      autoDecisions: [
        { decision: 'allow', decidedAt: 75 },
        { decision: 'deny', decidedAt: 76 },
      ],
      retryAudits: [{ ts: 78 }],
      completedAtByTask: new Map([['t1', 90]]),
    })

    expect(digest.snapshot.total).toBe(4)
    expect(digest.snapshot.review).toBe(1)
    expect(digest.snapshot.waiting).toBe(2)
    expect(digest.ready.map((task) => task.id)).toEqual(['t1'])
    expect(digest.blocked.map((task) => task.id)).toEqual(['t2'])
    expect(digest.dropped.map((task) => task.id)).toEqual(['t3'])
    expect(digest.changes.completed).toBe(1)
    expect(digest.changes.autoAllowed).toBe(1)
    expect(digest.changes.autoDenied).toBe(1)
    expect(digest.changes.retried).toBe(1)
    expect(digest.snapshot.attention).toEqual({
      needsApproval: 1,
      needsReply: 1,
      needsAttention: 0,
      needsReview: 1,
    })
    expect(digest.oldestWaiting?.id).toBe('t3')
    expect(JSON.stringify(digest)).not.toContain('SECRET_PROMPT')
    expect(digest).toMatchSnapshot()
  })

  it('handles an empty workspace', () => {
    const digest = buildDigest({
      workspaceId: 'w1',
      now: 100,
      windowStart: 0,
      policyVersion: 'abc123abc123',
      tasks: [],
      autoDecisions: [],
      retryAudits: [],
      completedAtByTask: new Map(),
    })
    expect(digest.snapshot.total).toBe(0)
    expect(digest.ready).toEqual([])
    expect(digest.blocked).toEqual([])
    expect(digest.dropped).toEqual([])
    expect(digest.oldestWaiting).toBeNull()
  })

  it('orders by oldest wait and includes window boundaries', () => {
    const digest = buildDigest({
      workspaceId: 'w1',
      now: 100,
      windowStart: 50,
      policyVersion: 'abc123abc123',
      tasks: [
        {
          ...base,
          id: 'new',
          title: '新等待',
          status: 'waiting_input',
          waitingReason: 'approval',
          createdAt: 50,
          updatedAt: 90,
        },
        {
          ...base,
          id: 'old',
          title: '旧等待',
          status: 'waiting_input',
          waitingReason: 'approval',
          createdAt: 50,
          updatedAt: 60,
        },
      ],
      autoDecisions: [],
      retryAudits: [],
      completedAtByTask: new Map(),
    })
    expect(digest.blocked.map((task) => task.id)).toEqual(['old', 'new'])
    expect(digest.oldestWaiting?.id).toBe('old')
    expect(digest.changes.created).toBe(2)
    expect(digest.changes.updated).toBe(2)
  })

  it('caps arrays at 20 and ignores tasks outside the workspace', () => {
    const digest = buildDigest({
      workspaceId: 'w1',
      now: 100,
      windowStart: 0,
      policyVersion: 'abc123abc123',
      tasks: [
        ...Array.from({ length: 25 }, (_, index) => ({
          ...base,
          id: `r${index}`,
          title: `ready-${index}`,
        })),
        { ...base, id: 'other', workspaceId: 'w2' },
      ],
      autoDecisions: [],
      retryAudits: [],
      completedAtByTask: new Map(),
    })
    expect(digest.ready).toHaveLength(20)
    expect(digest.snapshot.total).toBe(25)
  })
})
