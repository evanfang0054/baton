import { describe, expect, it } from 'vitest'
import { ContextSnapshot, TaskDetail } from '../src/index.js'

const snapshot = {
  included: [{ id: 'n1', type: 'text' as const, title: '需求', depth: 0, chars: 12 }],
  dropped: [{ id: 'n2', reason: 'sensitive' as const, title: '.env' }],
  truncated: false,
  redactedPaths: ['.env'],
  relations: [
    {
      from: 'n1',
      to: 'n3',
      type: 'context' as const,
      fromTitle: '需求',
      toTitle: '接口设计',
      includedFrom: true,
      includedTo: false,
    },
  ],
  relationsTruncated: false,
  injections: [],
}

describe('ContextSnapshot', () => {
  it('parses a complete snapshot', () => {
    expect(ContextSnapshot.parse(snapshot)).toEqual(snapshot)
  })

  it('rejects unknown drop reasons', () => {
    expect(() =>
      ContextSnapshot.parse({
        ...snapshot,
        dropped: [{ id: 'n2', reason: 'nope' }],
      }),
    ).toThrow()
  })
})

describe('TaskDetail', () => {
  const task = {
    id: 't1',
    workspaceId: 'w1',
    nodeId: 'n1',
    title: 'demo',
    prompt: '<task>demo</task>',
    status: 'todo' as const,
    waitingReason: null,
    engine: 'claude-sdk' as const,
    workspaceMode: 'main' as const,
    branch: null,
    worktreePath: null,
    verifyCommand: null,
    retryCount: 0,
    dangerouslySkipPermissions: false,
    createdAt: 1,
    updatedAt: 1,
  }

  it('defaults context to null for old tasks', () => {
    expect(TaskDetail.parse(task).context).toBeNull()
  })

  it('parses an explicit context snapshot', () => {
    expect(TaskDetail.parse({ ...task, context: snapshot }).context).toEqual(snapshot)
  })
})
