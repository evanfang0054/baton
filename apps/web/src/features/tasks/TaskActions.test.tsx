import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { TaskActions } from './TaskActions'

function renderActions(
  status:
    'todo' | 'queued' | 'running' | 'waiting_input' | 'review' | 'failed' | 'done' | 'cancelled',
  send = vi.fn(),
  attention: 'none' | 'needs_attention' = 'none',
  sticky = false,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send.mockResolvedValue(undefined)}>
        <TaskActions
          taskId="t1"
          workspaceId="w1"
          status={status}
          attention={attention}
          sticky={sticky}
        />
      </CommandProvider>
    </QueryClientProvider>,
  )
  return send
}

describe('TaskActions', () => {
  it('renders a sticky footer when requested', () => {
    renderActions('todo', vi.fn(), 'none', true)
    expect(screen.getByText('任务已创建，尚未开工。').closest('section')?.className).toContain(
      'sticky',
    )
  })

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

  it('retries a failed task with an optional note', async () => {
    const send = renderActions('failed')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    fireEvent.change(screen.getByLabelText('重试备注'), { target: { value: '再试一次' } })
    fireEvent.click(screen.getByRole('button', { name: '确认重试' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'task.retry',
        payload: { taskId: 't1', note: '再试一次' },
      }),
    )
  })

  it('reopens a done task without a note', async () => {
    const send = renderActions('done')
    fireEvent.click(screen.getByRole('button', { name: '重新打开' }))
    fireEvent.click(screen.getByRole('button', { name: '确认重新打开' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'task.reopen',
        payload: { taskId: 't1' },
      }),
    )
  })
})
