import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { CreateTaskForm } from './CreateTaskForm'

function renderForm(send = vi.fn().mockResolvedValue({ taskId: 't1' })) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onCreated = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <CreateTaskForm nodeId="n1" workspaceId="w1" defaultTitle="Agent 1" onCreated={onCreated} />
      </CommandProvider>
    </QueryClientProvider>,
  )
  return { send, onCreated }
}

describe('CreateTaskForm', () => {
  it('requires a prompt and sends the task.create payload', async () => {
    const { send, onCreated } = renderForm()
    const submit = screen.getByRole('button', { name: '创建任务' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('任务标题'), { target: { value: '演示任务' } })
    fireEvent.change(screen.getByLabelText('任务说明'), { target: { value: '请完成演示' } })
    fireEvent.change(screen.getByLabelText('验收命令'), {
      target: { value: 'node -e "console.log(1)"' },
    })
    expect(submit).not.toBeDisabled()
    fireEvent.click(submit)

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'task.create',
        payload: {
          workspaceId: 'w1',
          nodeId: 'n1',
          title: '演示任务',
          prompt: '请完成演示',
          contextNodeIds: [],
          engine: 'fake',
          workspaceMode: 'main',
          verifyCommand: 'node -e "console.log(1)"',
        },
      }),
    )
    expect(onCreated).toHaveBeenCalledWith('t1')
  })
})
