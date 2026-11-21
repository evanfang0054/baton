import type { TaskSummary } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { MobileBoardList } from './MobileBoardList'

const { send } = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue(undefined) }))

function task(id: string, title: string): TaskSummary {
  return {
    id,
    workspaceId: 'w1',
    nodeId: `n-${id}`,
    title,
    prompt: '',
    status: 'todo',
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
  }
}

function renderList(tasks: TaskSummary[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <MobileBoardList
          tasks={tasks}
          selectedTaskId={null}
          onSelectTask={() => {}}
          onOpenSupervisor={() => {}}
        />
      </CommandProvider>
    </QueryClientProvider>,
  )
}

describe('MobileBoardList batch start', () => {
  beforeEach(() => send.mockClear())

  it('enqueues each selected todo task', async () => {
    renderList([task('t1', 'A'), task('t2', 'B')])

    await userEvent.click(screen.getByRole('button', { name: '选择待办' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 A' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 B' }))
    await userEvent.click(screen.getByRole('button', { name: '开工 2 个' }))

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'task.enqueue', payload: { taskId: 't1' } })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'task.enqueue', payload: { taskId: 't2' } })
  })

  it('does not select non-todo tasks', async () => {
    const running = { ...task('t3', 'C'), status: 'running' as const }
    renderList([task('t1', 'A'), running])

    await userEvent.click(screen.getByRole('button', { name: '选择待办' }))
    expect(screen.getByRole('checkbox', { name: '选择 A' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '选择 C' })).not.toBeInTheDocument()
  })
})
