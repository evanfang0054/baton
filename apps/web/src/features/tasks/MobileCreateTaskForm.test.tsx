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

beforeEach(() => {
  send.mockReset()
  send.mockResolvedValue({ taskId: 't1' })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/engines') {
        return Response.json({ engines: [{ engine: 'fake', status: 'available' }] })
      }
      return Response.json({})
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onCreated = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <MobileCreateTaskForm
          workspaceId="w1"
          canvasId="c1"
          workspaceTrusted
          nodes={[agent]}
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
})
