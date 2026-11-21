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
    engine: 'fake',
    workspaceMode: 'main',
    branch: null,
    worktreePath: null,
    verifyCommand: null,
    dangerouslySkipPermissions: false,
    retryCount: 0,
    createdAt: 1,
    updatedAt: 1,
    attention: 'none',
    waitingSince: null,
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
})
