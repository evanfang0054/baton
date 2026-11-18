import type { SupervisorMessagesResponse } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { useAppStore } from '../../stores/app'
import { SupervisorComposer } from './SupervisorComposer'
import { useSupervisorStreamStore } from './stream-store'

beforeEach(() => {
  useAppStore.setState({ contextNodeIds: [] })
  useSupervisorStreamStore.getState().reset()
})

function renderComposer(
  send: (input: unknown) => Promise<unknown>,
  props: Partial<ComponentProps<typeof SupervisorComposer>> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send as never}>
        <SupervisorComposer workspaceId="w1" contextNodes={[]} targetAgent={null} {...props} />
      </CommandProvider>
    </QueryClientProvider>,
  )
  return { client, ...view }
}

describe('SupervisorComposer', () => {
  it('sends context and target in the payload', async () => {
    const send = vi.fn().mockResolvedValue({ threadId: 'th1', messageId: 'm1' })
    const { client } = renderComposer(send, {
      contextNodes: [{ id: 'n1', type: 'text', title: '需求 A' } as never],
      targetAgent: { id: 'a1', title: 'Agent 1' },
    })
    client.setQueryData<SupervisorMessagesResponse>(queryKeys.supervisorMessages('w1'), {
      threadId: 'th1',
      messages: [],
    })
    expect(screen.getByText('需求 A')).toBeVisible()
    expect(screen.getByText('目标 Agent 1')).toBeVisible()

    await userEvent.type(screen.getByRole('textbox'), '给这个 Agent 建个任务')
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(send).toHaveBeenCalledWith({
      type: 'supervisor.send',
      payload: {
        workspaceId: 'w1',
        requestId: expect.any(String),
        text: '给这个 Agent 建个任务',
        contextNodeIds: ['n1'],
        targetNodeId: 'a1',
      },
    })

    const cached = client.getQueryData<SupervisorMessagesResponse>(
      queryKeys.supervisorMessages('w1'),
    )
    expect(cached?.messages[0]).toMatchObject({
      role: 'user',
      content: '给这个 Agent 建个任务',
      meta: { contextNodeIds: ['n1'], targetNodeId: 'a1' },
    })
    expect(useSupervisorStreamStore.getState().status).toBe('streaming')
  })

  it('does not send on IME composition Enter', async () => {
    const send = vi.fn()
    renderComposer(send)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, '你好')
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))
    expect(send).not.toHaveBeenCalled()
  })

  it('disables sending while a turn is streaming', () => {
    useSupervisorStreamStore.setState({ status: 'streaming', threadId: 'th1', messageId: 'm1' })
    renderComposer(vi.fn())
    expect(screen.getByText('总管正在处理上一条')).toBeVisible()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
  })
})
