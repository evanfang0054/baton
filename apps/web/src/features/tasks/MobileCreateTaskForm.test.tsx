import type { Node } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { MobileCreateTaskForm } from './MobileCreateTaskForm'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))

const agent = {
  id: 'a1',
  canvasId: 'c1',
  type: 'agent',
  x: 0,
  y: 0,
  w: 320,
  h: 200,
  groupId: null,
  createdAt: 1,
  updatedAt: 1,
  data: { title: '主 Agent', engine: 'claude-sdk', taskId: null },
} as Node

function stubEngines(engines: Array<string | { engine: string; status: string; reason?: string }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/engines') {
        return Response.json({
          engines: engines.map((entry) =>
            typeof entry === 'string' ? { engine: entry, status: 'available' } : entry,
          ),
        })
      }
      return Response.json({})
    }),
  )
}

beforeEach(() => {
  send.mockReset()
  send.mockResolvedValue({ taskId: 't1' })
  stubEngines(['claude-sdk'])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderForm(nodes: Node[] = [agent]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onCreated = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <MobileCreateTaskForm
          workspaceId="w1"
          canvasId="c1"
          workspaceTrusted
          nodes={nodes}
          onCreated={onCreated}
          onCancel={() => {}}
        />
      </CommandProvider>
    </QueryClientProvider>,
  )
  return onCreated
}

describe('MobileCreateTaskForm', () => {
  it('creates a task for an existing agent', async () => {
    const onCreated = renderForm()
    await screen.findByLabelText('任务标题')
    await userEvent.type(screen.getByLabelText('任务标题'), '移动任务')
    await userEvent.type(screen.getByLabelText('任务 prompt'), '做一件事')
    await userEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.create',
          payload: expect.objectContaining({
            nodeId: 'a1',
            title: '移动任务',
            prompt: '做一件事',
            engine: 'claude-sdk',
          }),
        }),
      ),
    )
    expect(onCreated).toHaveBeenCalledWith('t1')
  })

  it('retries a failed enqueue without creating a duplicate task', async () => {
    const onCreated = renderForm([agent])
    await screen.findByLabelText('任务标题')
    send.mockImplementation(async (command: { type: string }) => {
      if (command.type === 'task.create') return { taskId: 't1' }
      if (command.type === 'task.enqueue') throw new Error('offline')
      return {}
    })

    await userEvent.type(screen.getByLabelText('任务 prompt'), '做一件事')
    await userEvent.click(screen.getByLabelText('创建后立即开工'))
    await userEvent.click(screen.getByRole('button', { name: '创建并开工' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('t1'))

    await userEvent.click(screen.getByRole('button', { name: '创建并开工' }))
    await waitFor(() =>
      expect(send.mock.calls.filter(([command]) => command.type === 'task.create')).toHaveLength(1),
    )
  })

  it('disables submit when engines fail to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    )
    renderForm([agent])
    await screen.findByText('引擎状态加载失败，请稍后重试')
    await userEvent.type(screen.getByLabelText('任务 prompt'), '做一件事')
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled()
  })

  it('explains when no engine is available', async () => {
    stubEngines([{ engine: 'claude-sdk', status: 'unavailable', reason: 'SDK missing' }])
    renderForm([agent])

    expect(await screen.findByRole('alert')).toHaveTextContent('没有可用引擎')
    expect(screen.getByRole('alert')).toHaveTextContent('SDK missing')
    await userEvent.type(screen.getByLabelText('任务 prompt'), '做一件事')
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled()
  })
})
