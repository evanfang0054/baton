import type { TaskSummary } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { TaskBoard } from './TaskBoard'

function task(overrides: Partial<TaskSummary>): TaskSummary {
  return {
    id: 't1',
    workspaceId: 'w1',
    nodeId: null,
    title: '任务',
    prompt: '',
    status: 'running',
    waitingReason: null,
    engine: 'claude-sdk',
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

function renderBoard(tasks: TaskSummary[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={vi.fn()}>
        <TaskBoard
          tasks={tasks}
          agentNodes={[]}
          selectedTaskId={null}
          expanded
          pinned={false}
          onSelectTask={vi.fn()}
          onClose={vi.fn()}
        />
      </CommandProvider>
    </QueryClientProvider>,
  )
}

describe('TaskBoard filters', () => {
  it('shows only needs-me tasks and searches titles', async () => {
    renderBoard([
      task({ id: 'a', title: '待验收任务', status: 'review', attention: 'needs_review' }),
      task({ id: 'b', title: '运行中任务', status: 'running' }),
      task({ id: 'c', title: '待办任务', status: 'todo' }),
    ])
    expect(screen.getByText('运行中任务')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '需要我' }))
    expect(screen.getByText('待验收任务')).toBeInTheDocument()
    expect(screen.queryByText('运行中任务')).not.toBeInTheDocument()
    expect(screen.queryByText('待办任务')).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('搜索任务'), '不存在')
    expect(screen.queryByText('待验收任务')).not.toBeInTheDocument()
  })

  it('includes AC failures and over-budget tasks in needs-me', async () => {
    renderBoard([
      task({
        id: 'ac-fail',
        title: 'AC 未过任务',
        status: 'running',
        acceptance: {
          contractId: 'ac1',
          version: 1,
          revision: 0,
          status: 'draft',
          counts: { total: 2, pass: 1, fail: 1, pending: 0, waived: 0 },
          verdict: 'fail',
          topFailures: [{ text: '错误提示', evidence: null }],
        },
      }),
      task({
        id: 'over-budget',
        title: '超预算任务',
        status: 'running',
        budget: {
          budgetUsd: 2,
          spentUsd: 2.5,
          remainingUsd: 0,
          ratio: 1.25,
          overBudget: true,
          nearBudget: false,
          workerCostUsd: 2.5,
          verifierCostUsd: 0,
          turns: 3,
        },
      }),
      task({ id: 'plain', title: '普通任务', status: 'running' }),
    ])

    await userEvent.click(screen.getByRole('button', { name: '需要我' }))
    expect(screen.getByText('AC 未过任务')).toBeInTheDocument()
    expect(screen.getByText('超预算任务')).toBeInTheDocument()
    expect(screen.queryByText('普通任务')).not.toBeInTheDocument()
  })
})
