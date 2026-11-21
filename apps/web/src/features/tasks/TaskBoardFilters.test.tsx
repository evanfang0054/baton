import type { TaskSummary } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TaskBoardFilters, filterTasks } from './TaskBoardFilters'

function task(overrides: Partial<TaskSummary>): TaskSummary {
  return {
    id: 't1',
    workspaceId: 'w1',
    nodeId: 'n1',
    title: '任务',
    prompt: '',
    status: 'running',
    waitingReason: null,
    engine: 'fake',
    workspaceMode: 'main',
    branch: null,
    worktreePath: null,
    verifyCommand: null,
    dangerouslySkipPermissions: false,
    budgetUsd: null,
    enqueuedAt: null,
    retryCount: 0,
    createdAt: 1,
    updatedAt: 1,
    attention: 'none',
    waitingSince: null,
    acceptance: null,
    budget: null,
    ...overrides,
  }
}

describe('filterTasks', () => {
  it('filters needs_me and sorts by waiting', () => {
    const tasks = [
      task({ id: 'a', status: 'review', attention: 'needs_review', waitingSince: 20 }),
      task({ id: 'b', status: 'waiting_input', attention: 'needs_reply', waitingSince: 10 }),
      task({ id: 'c', status: 'running', attention: 'none', waitingSince: null }),
    ]
    expect(filterTasks(tasks, { filter: 'needs_me', query: '' }).map((item) => item.id)).toEqual([
      'b',
      'a',
    ])
  })

  it('searches title case-insensitively', () => {
    const tasks = [task({ id: 'a', title: 'Login Page' }), task({ id: 'b', title: '看板' })]
    expect(filterTasks(tasks, { filter: 'all', query: 'login' })).toHaveLength(1)
    expect(filterTasks(tasks, { filter: 'all', query: '看板' })).toHaveLength(1)
  })

  it('filters review and waiting_input', () => {
    const tasks = [
      task({ id: 'a', status: 'review', attention: 'needs_review' }),
      task({ id: 'b', status: 'waiting_input', attention: 'needs_reply' }),
      task({ id: 'c', status: 'todo' }),
    ]
    expect(filterTasks(tasks, { filter: 'review', query: '' }).map((t) => t.id)).toEqual(['a'])
    expect(filterTasks(tasks, { filter: 'waiting', query: '' }).map((t) => t.id)).toEqual(['b'])
  })
})

describe('TaskBoardFilters', () => {
  it('switches filter and searches', async () => {
    const onFilter = vi.fn()
    const onQuery = vi.fn()
    render(<TaskBoardFilters filter="all" query="" onFilter={onFilter} onQuery={onQuery} />)
    await userEvent.click(screen.getByRole('button', { name: '需要我' }))
    expect(onFilter).toHaveBeenCalledWith('needs_me')
    await userEvent.type(screen.getByLabelText('搜索任务'), '登录')
    expect(onQuery).toHaveBeenCalled()
  })
})
