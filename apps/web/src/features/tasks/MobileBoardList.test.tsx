import type { TaskSummary } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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

describe('MobileBoardList', () => {
  it('puts attention tasks first and opens a task', async () => {
    const onSelectTask = vi.fn()
    render(
      <MobileBoardList
        tasks={[
          task({ id: 't1', title: '待办任务', status: 'todo' }),
          task({ id: 't2', title: '待审批', attention: 'needs_approval', status: 'waiting_input' }),
        ]}
        selectedTaskId={null}
        onSelectTask={onSelectTask}
        onOpenSupervisor={() => {}}
      />,
    )

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((node) => (node.textContent ?? '').replace(/\s*\(\d+\)$/, ''))
    expect(headings).toEqual(['需要我处理', '进行中', '待办'])

    await userEvent.click(screen.getByRole('button', { name: /待审批/ }))
    expect(onSelectTask).toHaveBeenCalledWith('t2')
  })

  it('shows empty state actions', () => {
    render(
      <MobileBoardList
        tasks={[]}
        selectedTaskId={null}
        onSelectTask={() => {}}
        onOpenSupervisor={() => {}}
      />,
    )
    expect(screen.getByText('没有需要你处理的任务')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '让总管建任务' })).toBeInTheDocument()
  })
})
