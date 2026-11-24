import type { TaskSummary } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TaskBoard } from './TaskBoard'

const { send } = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('../../lib/command-context', () => ({ useCommand: () => send }))

function task(id: string, title: string): TaskSummary {
  return {
    id,
    workspaceId: 'w1',
    nodeId: `n-${id}`,
    title,
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
  }
}

function renderBoard(tasks: TaskSummary[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TaskBoard
        tasks={tasks}
        agentNodes={[]}
        selectedTaskId={null}
        expanded
        pinned={false}
        onSelectTask={() => {}}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  )
}

describe('TaskBoard batch start', () => {
  it('renders the board as a full-width overlay', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <TaskBoard
          compact
          tasks={[]}
          agentNodes={[]}
          selectedTaskId={null}
          expanded
          pinned={false}
          onSelectTask={() => {}}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    )
    const overlay = screen.getByTestId('task-board-overlay')
    expect(overlay.className).toContain('right-0')
    expect(overlay.className).toContain('left-16')
    expect(overlay.className).not.toContain('w-[min(')
  })

  it('selects todo tasks and enqueues each', async () => {
    renderBoard([task('t1', 'A'), task('t2', 'B')])

    await userEvent.click(screen.getByRole('button', { name: '批量开工' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 A' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 B' }))
    await userEvent.click(screen.getByRole('button', { name: '开工 2 个' }))

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'task.enqueue', payload: { taskId: 't1' } })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'task.enqueue', payload: { taskId: 't2' } })
  })

  it('only allows todo tasks to be selected', async () => {
    const running = { ...task('t3', 'C'), status: 'running' as const }
    renderBoard([task('t1', 'A'), running])

    await userEvent.click(screen.getByRole('button', { name: '批量开工' }))
    expect(screen.getByRole('checkbox', { name: '选择 A' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '选择 C' })).not.toBeInTheDocument()
  })
})
