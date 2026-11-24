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
  engine: 'claude-sdk',
  workspaceMode: 'main',
  branch: null,
  worktreePath: null,
  verifyCommand: null,
  dangerouslySkipPermissions: false,
  enqueuedAt: null,
  retryCount: 0,
  createdAt: 1,
  updatedAt: 2,
  attention: 'needs_reply',
  waitingSince: Date.now() - 3 * 60_000,
  acceptance: null,
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
    expect(screen.getByText(/超过 30 分钟/)).toBeInTheDocument()
  })

  it('does not repeat the review label twice', () => {
    render(
      <TaskCard
        task={{ ...task, status: 'review', attention: 'needs_review', waitingReason: null }}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getAllByText('待验收')).toHaveLength(1)
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
    expect(screen.getByText(/超过 30 分钟/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '看现场' }))
    expect(onOpenScene).toHaveBeenCalledWith('t1')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows acceptance badges with text and icons', () => {
    render(
      <TaskCard
        task={{
          ...task,
          acceptance: {
            contractId: 'ac1',
            version: 1,
            revision: 0,
            status: 'draft',
            counts: { total: 3, pass: 2, fail: 1, pending: 0, waived: 0 },
            verdict: 'fail',
            topFailures: [{ text: '深链参数未校验', evidence: null }],
          },
        }}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('AC 2/3')).toBeInTheDocument()
  })

  it('does not render legacy budget badges', () => {
    const legacy = {
      spentUsd: 3,
      remainingUsd: 0,
      ratio: 1.5,
      overBudget: true,
      nearBudget: false,
      workerCostUsd: 3,
      verifierCostUsd: 0,
      turns: 1,
    }
    render(
      <TaskCard task={{ ...task, budget: legacy } as unknown as TaskSummary} onSelect={vi.fn()} />,
    )
    expect(screen.queryByText('超预算')).not.toBeInTheDocument()
    expect(screen.queryByText('接近预算')).not.toBeInTheDocument()
  })
})
