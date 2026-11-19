import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { MobileNodeManager } from './MobileNodeManager'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))

beforeEach(() => {
  send.mockReset()
  send.mockResolvedValue({ nodeId: 'n1' })
})

it('creates a text node', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <MobileNodeManager canvasId="c1" nodes={[]} onClose={() => {}} />
      </CommandProvider>
    </QueryClientProvider>,
  )

  await userEvent.click(screen.getByRole('button', { name: '新建文本' }))
  await userEvent.type(screen.getByLabelText('文本内容'), '一条上下文')
  await userEvent.click(screen.getByRole('button', { name: '保存' }))

  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'node.create',
        payload: expect.objectContaining({
          canvasId: 'c1',
          node: expect.objectContaining({ type: 'text', data: { content: '一条上下文' } }),
        }),
      }),
    ),
  )
})
