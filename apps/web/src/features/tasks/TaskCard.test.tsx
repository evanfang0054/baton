import type { TaskSummary } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TaskCard } from './TaskCard'

const task: TaskSummary = {
  id: 't1',
  workspaceId: 'w1',
  nodeId: 'n1',
  title: '修复登录页',
  prompt: '<task>demo</task>',
  status: 'waiting_input',
  waitingReason: 'question',
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
  updatedAt: 2,
  attention: 'needs_reply',
  waitingSince: Date.now() - 3 * 60_000,
  acceptance: null,
  budget: null,
}

describe('TaskCard', () => {
  it('shows title, attention and waiting time', () => {
    render(<TaskCard task={task} onSelect={vi.fn()} />)
    expect(screen.getByText('修复登录页')).toBeInTheDocument()
    expect(screen.getByText('待回复')).toBeInTheDocument()
    expect(screen.getByText('已等 3 分钟')).toBeInTheDocument()
  })

  it('derives stale from waiting time without the stale prop', () => {
    render(
      <TaskCard task={{ ...task, waitingSince: Date.now() - 31 * 60_000 }} onSelect={vi.fn()} />,
    )
    expect(screen.getByText('已等待超过 30 分钟')).toBeInTheDocument()
  })

  it('shows stale text and opens the scene without selecting the task', async () => {
    const onSelect = vi.fn()
    const onOpenScene = vi.fn()
    render(
      <TaskCard
        task={{ ...task, waitingSince: Date.now() - 31 * 60_000 }}
        stale
        onSelect={onSelect}
        onOpenScene={onOpenScene}
      />,
    )
    expect(screen.getByText('已等待超过 30 分钟')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '看现场' }))
    expect(onOpenScene).toHaveBeenCalledWith('t1')
    expect(onSelect).not.toHaveBeenCalled()
  })
})
