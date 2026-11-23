import type { TaskSummary } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { taskDropAction } from './task-drag'

function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 't1',
    workspaceId: 'w1',
    nodeId: 'n1',
    title: '任务',
    prompt: '',
    status: 'todo',
    waitingReason: null,
    engine: 'claude-sdk',
    workspaceMode: 'main',
    branch: null,
    worktreePath: null,
    verifyCommand: null,
    dangerouslySkipPermissions: false,
    enqueuedAt: null,
    retryCount: 0,
    createdAt: 1,
    updatedAt: 1,
    attention: 'none',
    waitingSince: null,
    acceptance: null,
    ...overrides,
  }
}

describe('taskDropAction', () => {
  it('starts todo work when dropped into running', () => {
    expect(taskDropAction(task({ status: 'todo' }), 'running')).toEqual({ kind: 'enqueue' })
  })

  it('retries failed tasks from running or todo', () => {
    expect(taskDropAction(task({ status: 'failed' }), 'running')).toEqual({ kind: 'retry' })
    expect(taskDropAction(task({ status: 'failed' }), 'todo')).toEqual({ kind: 'retry' })
  })

  it('reopens done tasks only when dropped back to todo', () => {
    expect(taskDropAction(task({ status: 'done' }), 'todo')).toEqual({ kind: 'reopen' })
    expect(taskDropAction(task({ status: 'done' }), 'running')).toMatchObject({ kind: 'none' })
  })

  it('enqueues stalled waiting tasks', () => {
    const stalled = task({ status: 'waiting_input', waitingReason: 'stalled' })
    expect(taskDropAction(stalled, 'running')).toEqual({ kind: 'enqueue' })
    expect(taskDropAction({ ...stalled, waitingReason: 'question' }, 'running')).toMatchObject({
      kind: 'none',
    })
  })

  it('approves review tasks when dropped into done', () => {
    expect(taskDropAction(task({ status: 'review', attention: 'needs_review' }), 'done')).toEqual({
      kind: 'approve',
    })
  })

  it('asks for cancellation when dropping an active task into closed', () => {
    expect(taskDropAction(task({ status: 'running' }), 'closed')).toEqual({ kind: 'cancel' })
    expect(taskDropAction(task({ status: 'done' }), 'closed')).toMatchObject({ kind: 'none' })
  })

  it('never lets a task be dragged into agent-driven columns', () => {
    expect(taskDropAction(task({ status: 'running' }), 'waiting')).toMatchObject({ kind: 'none' })
    expect(taskDropAction(task({ status: 'review' }), 'review')).toMatchObject({ kind: 'none' })
  })
})
