import type { TaskStatus } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from '@heroui/react/toast'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider, type CommandSender } from '../../lib/command-context'
import type { CommandInput } from '../../lib/ws'
import { HandoffButton } from './HandoffButton'

vi.mock('@heroui/react/toast', () => ({
  toast: { success: vi.fn(), info: vi.fn(), danger: vi.fn() },
}))

function renderButton(status: TaskStatus, send: CommandSender = async () => ({ warnings: [] })) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <HandoffButton taskId="t1" workspaceId="w1" status={status} />
      </CommandProvider>
    </QueryClientProvider>,
  )
  return { send, view }
}

describe('HandoffButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders for review/done/failed/cancelled only', () => {
    for (const status of ['review', 'done', 'failed', 'cancelled'] as const) {
      const { view } = renderButton(status)
      expect(screen.getByRole('button', { name: '生成交接节点' })).toBeVisible()
      view.unmount()
    }
    for (const status of ['todo', 'queued', 'running', 'waiting_input', 'verifying'] as const) {
      const { view } = renderButton(status)
      expect(view.container).toBeEmptyDOMElement()
      view.unmount()
    }
  })

  it('sends task.handoff and refreshes the canvas', async () => {
    const send = vi.fn(async (_input: CommandInput) => ({ warnings: [] }))
    renderButton('review', send)
    fireEvent.click(screen.getByRole('button', { name: '生成交接节点' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'task.handoff',
        payload: { taskId: 't1', workspaceId: 'w1' },
      }),
    )
    expect(toast.success).toHaveBeenCalledWith('已生成交接节点，可在画布中选中它创建下一个任务')
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('shows worktree warnings from the ack', async () => {
    const send = vi.fn(async (_input: CommandInput) => ({
      warnings: ['源任务在隔离 worktree，变更文件在主工作区不可读。'],
    }))
    renderButton('review', send)
    fireEvent.click(screen.getByRole('button', { name: '生成交接节点' }))
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith('源任务在隔离 worktree，变更文件在主工作区不可读。'),
    )
  })

  it('shows a danger toast when the command fails', async () => {
    const send = vi.fn(async (_input: CommandInput) => {
      throw new Error('handoff_invalid')
    })
    renderButton('review', send)
    fireEvent.click(screen.getByRole('button', { name: '生成交接节点' }))
    await waitFor(() => expect(toast.danger).toHaveBeenCalledWith('handoff_invalid'))
  })
})
