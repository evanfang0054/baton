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

function renderForm(
  send = vi.fn().mockResolvedValue({ taskId: 't1' }),
  workspaceTrusted = false,
  defaultTitle = 'Agent 1',
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onCreated = vi.fn()
  const tree = (title: string) => (
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <CreateTaskForm
          nodeId="n1"
          workspaceId="w1"
          workspaceTrusted={workspaceTrusted}
          defaultTitle={title}
          onCreated={onCreated}
        />
      </CommandProvider>
    </QueryClientProvider>
  )
  const view = render(tree(defaultTitle))
  return {
    send,
    onCreated,
    setDefaultTitle: (title: string) => view.rerender(tree(title)),
  }
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
          dangerouslySkipPermissions: false,
          verifyCommand: 'node -e "console.log(1)"',
        },
      }),
    )
    expect(onCreated).toHaveBeenCalledWith('t1')
  })

  it('disables skip permissions until the workspace is trusted', async () => {
    stubEngines([{ engine: 'fake', status: 'available' }])
    renderForm(vi.fn().mockResolvedValue({ taskId: 't1' }), false)
    expect(screen.getByLabelText('跳过权限确认')).toBeDisabled()
  })

  it('sends the bypass flag only for a trusted workspace', async () => {
    stubEngines([{ engine: 'fake', status: 'available' }])
    const { send } = renderForm(vi.fn().mockResolvedValue({ taskId: 't1' }), true)
    await waitFor(() => expect(screen.getByLabelText('执行引擎')).toHaveValue('fake'))
    fireEvent.change(screen.getByLabelText('任务标题'), { target: { value: '演示任务' } })
    fireEvent.change(screen.getByLabelText('任务说明'), { target: { value: '请完成演示' } })
    fireEvent.click(screen.getByLabelText('跳过权限确认'))
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }))

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.create',
          payload: expect.objectContaining({ dangerouslySkipPermissions: true }),
        }),
      ),
    )
  })

  it('follows node title changes until the user edits the task title', async () => {
    stubEngines([{ engine: 'fake', status: 'available' }])
    const { setDefaultTitle } = renderForm()
    await waitFor(() => expect(screen.getByLabelText('执行引擎')).toHaveValue('fake'))
    expect(screen.getByLabelText('任务标题')).toHaveValue('Agent 1')

    setDefaultTitle('登录页 Agent')
    await waitFor(() => expect(screen.getByLabelText('任务标题')).toHaveValue('登录页 Agent'))

    fireEvent.change(screen.getByLabelText('任务标题'), { target: { value: '自定义标题' } })
    setDefaultTitle('另一个标题')
    expect(screen.getByLabelText('任务标题')).toHaveValue('自定义标题')
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
