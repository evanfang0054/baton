import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { CreateTaskForm } from './CreateTaskForm'

function stubEngines(engines: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/engines') {
        return Response.json({ engines })
      }
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
}

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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CreateTaskForm', () => {
  it('requires a prompt and sends the task.create payload with the preferred engine', async () => {
    stubEngines([
      { engine: 'claude-sdk', status: 'unknown', reason: 'reusing local login' },
      { engine: 'fake', status: 'available' },
    ])
    const { send, onCreated } = renderForm()
    const submit = screen.getByRole('button', { name: '创建任务' })
    expect(submit).toBeDisabled()
    await waitFor(() => expect(screen.getByLabelText('执行引擎')).toHaveValue('claude-sdk'))

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
          engine: 'claude-sdk',
          workspaceMode: 'main',
          verifyCommand: 'node -e "console.log(1)"',
        },
      }),
    )
    expect(onCreated).toHaveBeenCalledWith('t1')
  })

  it('falls back to the demo engine when Claude is unavailable', async () => {
    stubEngines([
      { engine: 'claude-sdk', status: 'unavailable', reason: 'SDK missing' },
      { engine: 'fake', status: 'available' },
    ])
    renderForm()
    await waitFor(() => expect(screen.getByLabelText('执行引擎')).toHaveValue('fake'))
    expect(screen.getByRole('option', { name: /Claude Code/ })).toBeDisabled()
  })
})
