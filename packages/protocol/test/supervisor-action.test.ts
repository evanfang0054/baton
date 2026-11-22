import { describe, expect, it } from 'vitest'
import { SupervisorAction } from '../src/supervisor-action.js'

const action = {
  id: 'action-1',
  workspaceId: 'workspace-1',
  threadId: 'thread-1',
  taskId: 'task-1',
  kind: 'retry',
  status: 'proposed',
  strength: 'inferred',
  mode: 'observe',
  reason: '任务失败，建议重试',
  payload: { taskId: 'task-1' },
  result: null,
  policyVersion: 'policy-1',
  mandateVersion: 'mandate-1',
  dedupeKey: 'retry:task-1:1',
  createdAt: 1,
  updatedAt: 1,
  expiresAt: 86_400_001,
  appliedAt: null,
  ignoredAt: null,
}

describe('SupervisorAction', () => {
  it('parses a proposed action', () => {
    expect(SupervisorAction.parse(action)).toMatchObject({ status: 'proposed' })
  })

  it('rejects an unknown status', () => {
    expect(SupervisorAction.safeParse({ ...action, status: 'done' }).success).toBe(false)
  })
})
