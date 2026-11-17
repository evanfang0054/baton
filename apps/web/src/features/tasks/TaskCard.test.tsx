import type { TaskSummary } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
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
  retryCount: 0,
  createdAt: 1,
  updatedAt: 2,
  attention: 'needs_reply',
  waitingSince: Date.now() - 3 * 60_000,
}

describe('TaskCard', () => {
  it('shows title, attention and waiting time', () => {
    render(<TaskCard task={task} onSelect={vi.fn()} />)
    expect(screen.getByText('修复登录页')).toBeInTheDocument()
    expect(screen.getByText('待回复')).toBeInTheDocument()
    expect(screen.getByText('已等 3 分钟')).toBeInTheDocument()
  })
})
