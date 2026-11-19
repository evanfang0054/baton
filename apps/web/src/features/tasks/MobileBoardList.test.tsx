import type { TaskSummary } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { MobileBoardList } from './MobileBoardList'

function task(overrides: Partial<TaskSummary>): TaskSummary {
  return {
    id: 't1',
    workspaceId: 'w1',
    nodeId: 'n1',
    title: '任务一',
    status: 'todo',
    attention: 'none',
    waitingReason: null,
    waitingSince: null,
    engine: 'fake',
    retryCount: 0,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  } as TaskSummary
}

function renderList({
  tasks,
  onSelectTask = () => {},
}: {
  tasks: TaskSummary[]
  onSelectTask?: (taskId: string) => void
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={vi.fn().mockResolvedValue(undefined)}>
        <MobileBoardList
          tasks={tasks}
          selectedTaskId={null}
          onSelectTask={onSelectTask}
          onOpenSupervisor={() => {}}
        />
      </CommandProvider>
    </QueryClientProvider>,
  )
}

describe('MobileBoardList', () => {
  it('splits attention into approval/reply/review and shows the oldest wait', () => {
    renderList({
      tasks: [
        task({
          id: 'a',
          title: '待审批',
          status: 'waiting_input',
          attention: 'needs_approval',
          waitingSince: 3,
        }),
        task({
          id: 'b',
          title: '待回复',
          status: 'waiting_input',
          attention: 'needs_reply',
          waitingSince: 1,
        }),
        task({
          id: 'c',
          title: '待验收',
          status: 'review',
          attention: 'needs_review',
          waitingSince: 2,
        }),
      ],
    })

    expect(screen.getByRole('heading', { name: /待审批/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /待回复/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /待验收/ })).toBeInTheDocument()
    expect(screen.getByText(/最久等待/)).toBeInTheDocument()
  })

  it('filters to todo tasks', async () => {
    renderList({
      tasks: [
        task({ id: 'a', title: '待审批', status: 'waiting_input', attention: 'needs_approval' }),
        task({ id: 'b', title: '待办任务', status: 'todo' }),
      ],
    })

    await userEvent.click(screen.getByRole('tab', { name: '待办' }))
    expect(screen.getByText('待办任务')).toBeInTheDocument()
    expect(screen.queryByText('待审批')).not.toBeInTheDocument()
  })

  it('opens a task from the attention group', async () => {
    const onSelectTask = vi.fn()
    renderList({
      tasks: [
        task({ id: 'a', title: '待审批', status: 'waiting_input', attention: 'needs_approval' }),
      ],
      onSelectTask,
    })

    await userEvent.click(screen.getByRole('button', { name: /待审批/ }))
    expect(onSelectTask).toHaveBeenCalledWith('a')
  })

  it('shows empty state actions', () => {
    renderList({ tasks: [] })
    expect(screen.getByText('没有待审批的任务')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '让总管建任务' })).toBeInTheDocument()
  })
})
