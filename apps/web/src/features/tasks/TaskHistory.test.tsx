import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTaskHistory } from '../../lib/api'
import { TaskHistory } from './TaskHistory'

vi.mock('../../lib/api', () => ({ getTaskHistory: vi.fn() }))

function wrap(onOpenDiff = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TaskHistory taskId="t1" onOpenDiff={onOpenDiff} />
    </QueryClientProvider>,
  )
  return onOpenDiff
}

afterEach(() => vi.mocked(getTaskHistory).mockReset())

describe('TaskHistory', () => {
  it('renders status, session and review items and opens diff', async () => {
    vi.mocked(getTaskHistory).mockResolvedValue({
      taskId: 't1',
      statusEvents: [
        { ordinal: 3, ts: 3, status: 'review', previousStatus: 'verifying', retryCount: 0 },
      ],
      sessions: [
        {
          id: 's1',
          taskId: 't1',
          adapter: 'fake',
          engineSessionId: null,
          status: 'ended',
          outcome: 'ready',
          startedAt: 1,
          endedAt: 2,
        },
      ],
      reviews: [
        {
          id: 'r1',
          taskId: 't1',
          verdict: 'approved',
          verifyExitCode: 0,
          verifyOutput: '',
          diffStat: { filesChanged: 1, insertions: 1, deletions: 0 },
          decidedAt: 4,
          diffAvailable: true,
        },
      ],
    })
    const onOpenDiff = wrap()

    fireEvent.click(screen.getByRole('button', { name: '历史' }))
    expect(await screen.findByText('待验收')).toBeInTheDocument()
    expect(screen.getByText(/会话 已结束/)).toBeInTheDocument()
    expect(screen.getByText(/退出码 0/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '查看改动' }))
    expect(onOpenDiff).toHaveBeenCalledWith('r1')
  })

  it('shows an empty state', async () => {
    vi.mocked(getTaskHistory).mockResolvedValue({
      taskId: 't1',
      statusEvents: [],
      sessions: [],
      reviews: [],
    })
    wrap()
    fireEvent.click(screen.getByRole('button', { name: '历史' }))
    await waitFor(() => expect(screen.getByText('还没有记录。')).toBeInTheDocument())
  })
})
