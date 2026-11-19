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
  data: { title: '主 Agent', engine: 'fake', taskId: null },
} as Node

const claudeAgent = {
  ...agent,
  id: 'a2',
  x: 400,
  data: { title: 'Claude Agent', engine: 'claude-sdk', taskId: null },
} as Node

function stubEngines(engines: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/engines') {
        return Response.json({
          engines: engines.map((engine) => ({ engine, status: 'available' })),
        })
      }
      return Response.json({})
    }),
  )
}

beforeEach(() => {
  send.mockReset()
  send.mockResolvedValue({ taskId: 't1' })
  stubEngines(['fake'])
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
          }),
        }),
      ),
    )
    expect(onCreated).toHaveBeenCalledWith('t1')
  })

  it('defaults to the agent engine instead of the preferred engine', async () => {
    stubEngines(['fake', 'claude-sdk'])
    renderForm([claudeAgent])
    await screen.findByLabelText('任务标题')
    await userEvent.type(screen.getByLabelText('任务 prompt'), '做一件事')
    await userEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.create',
          payload: expect.objectContaining({ nodeId: 'a2', engine: 'claude-sdk' }),
        }),
      ),
    )
  })

  it('switches engine when picking another agent', async () => {
    stubEngines(['fake', 'claude-sdk'])
    renderForm([agent, claudeAgent])
    await screen.findByLabelText('任务标题')

    await userEvent.click(screen.getByRole('button', { name: '主 Agent' }))
    await userEvent.click(screen.getByRole('button', { name: /Claude Agent/ }))
    await userEvent.click(screen.getByRole('button', { name: '确定' }))
    await userEvent.type(screen.getByLabelText('任务 prompt'), '做一件事')
    await userEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.create',
          payload: expect.objectContaining({ nodeId: 'a2', engine: 'claude-sdk' }),
        }),
      ),
    )
  })
})
