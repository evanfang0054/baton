import type { TaskSummary } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
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
    engine: 'claude-sdk',
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
  it('splits attention into approval/reply/review/attention and shows the oldest wait', () => {
    renderList({
      tasks: [
        task({
          id: 'a',
          title: '审批任务',
          status: 'waiting_input',
          attention: 'needs_approval',
          waitingSince: 3,
        }),
        task({
          id: 'b',
          title: '回复任务',
          status: 'waiting_input',
          attention: 'needs_reply',
          waitingSince: 1,
        }),
        task({
          id: 'c',
          title: '验收任务',
          status: 'review',
          attention: 'needs_review',
          waitingSince: 2,
        }),
        task({
          id: 'd',
          title: '停滞任务',
          status: 'waiting_input',
          attention: 'needs_attention',
          waitingSince: 0,
        }),
      ],
    })

    const approval = screen.getByRole('heading', { name: /待审批/ }).closest('section')
    const reply = screen.getByRole('heading', { name: /待回复/ }).closest('section')
    const review = screen.getByRole('heading', { name: /待验收/ }).closest('section')
    const attention = screen.getByRole('heading', { name: /需关注/ }).closest('section')
    expect(within(approval!).getByText('审批任务')).toBeInTheDocument()
    expect(within(reply!).getByText('回复任务')).toBeInTheDocument()
    expect(within(review!).getByText('验收任务')).toBeInTheDocument()
    expect(within(attention!).getByText('停滞任务')).toBeInTheDocument()
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

  it('collapses completed tasks and shows an empty state', async () => {
    renderList({
      tasks: [task({ id: 'd', title: '已完成任务', status: 'done' })],
    })

    await userEvent.click(screen.getByRole('tab', { name: '已完成' }))
    expect(screen.queryByText('已完成任务')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /已完成 \(1\)/ }))
    expect(screen.getByText('已完成任务')).toBeInTheDocument()
  })

  it('keeps cancelled tasks out of the completed section', async () => {
    renderList({
      tasks: [
        task({ id: 'd', title: '已完成任务', status: 'done' }),
        task({ id: 'c', title: '已取消任务', status: 'cancelled' }),
      ],
    })

    await userEvent.click(screen.getByRole('tab', { name: '已取消' }))
    await userEvent.click(screen.getByRole('button', { name: /已取消 \(1\)/ }))
    expect(screen.getByText('已取消任务')).toBeInTheDocument()
    expect(screen.queryByText('已完成任务')).not.toBeInTheDocument()
  })

  it('shows an empty completed state when there are no finished tasks', async () => {
    renderList({ tasks: [] })
    await userEvent.click(screen.getByRole('tab', { name: '已完成' }))
    await userEvent.click(screen.getByRole('button', { name: /已完成 \(0\)/ }))
    expect(screen.getByText('没有已完成任务')).toBeInTheDocument()
  })

  it('shows queued tasks in active, not todo', () => {
    renderList({ tasks: [task({ id: 'q', title: '排队任务', status: 'queued' })] })
    const active = screen.getByRole('heading', { name: /进行中/ }).closest('section')
    const todo = screen.getByRole('heading', { name: /待办/ }).closest('section')
    expect(within(active!).getByText('排队任务')).toBeInTheDocument()
    expect(within(todo!).queryByText('排队任务')).not.toBeInTheDocument()
  })

  it('switches to the todo filter when selecting', async () => {
    renderList({ tasks: [task({ id: 'a', title: '待办任务', status: 'todo' })] })
    await userEvent.click(screen.getByRole('button', { name: '选择待办' }))
    expect(screen.getByRole('tab', { name: '待办' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '全部' })).toBeDisabled()
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

  it('filters needs_me and marks stale without a scene action', async () => {
    renderList({
      tasks: [
        task({
          id: 'a',
          title: '待验收任务',
          status: 'review',
          attention: 'needs_review',
          waitingSince: Date.now() - 31 * 60_000,
        }),
        task({ id: 'b', title: '运行中任务', status: 'running' }),
      ],
    })
    expect(screen.getByText(/超过 30 分钟/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '看现场' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '需要我' }))
    expect(screen.getByText('待验收任务')).toBeInTheDocument()
    expect(screen.queryByText('运行中任务')).not.toBeInTheDocument()
  })
})
