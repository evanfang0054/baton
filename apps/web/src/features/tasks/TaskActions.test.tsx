import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { TaskActions } from './TaskActions'

function renderActions(
  status: 'todo' | 'queued' | 'running' | 'waiting_input' | 'review',
  send = vi.fn(),
  attention: 'none' | 'needs_attention' = 'none',
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send.mockResolvedValue(undefined)}>
        <TaskActions taskId="t1" workspaceId="w1" status={status} attention={attention} />
      </CommandProvider>
    </QueryClientProvider>,
  )
  return send
}

describe('TaskActions', () => {
  it('enqueues a todo task', async () => {
    const send = renderActions('todo')
    fireEvent.click(screen.getByRole('button', { name: '立即开工' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'task.enqueue',
        payload: { taskId: 't1' },
      }),
    )
  })

  it('cancels a running task after confirmation', async () => {
    const send = renderActions('running')
    fireEvent.click(screen.getByRole('button', { name: '取消任务' }))
    expect(screen.getByText('确认取消这个任务？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认取消' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'task.cancel',
        payload: { taskId: 't1' },
      }),
    )
  })

  it('re-enqueues a stalled task', async () => {
    const send = renderActions('waiting_input', vi.fn(), 'needs_attention')
    expect(screen.getByText(/任务已停滞/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新入队' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'task.enqueue',
        payload: { taskId: 't1' },
      }),
    )
  })

  it('renders nothing for review status', () => {
    const client = new QueryClient()
    const { container } = render(
      <QueryClientProvider client={client}>
        <CommandProvider send={vi.fn()}>
          <TaskActions taskId="t1" workspaceId="w1" status="review" attention="needs_review" />
        </CommandProvider>
      </QueryClientProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
