import type { Notice } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listNotices } from '../../lib/api'
import { DigestCard } from './DigestCard'

vi.mock('../../lib/api', () => ({
  listNotices: vi.fn(),
  readNotice: vi.fn(),
  generateDigest: vi.fn(),
}))
vi.mock('@heroui/react/toast', () => ({ toast: { success: vi.fn(), danger: vi.fn() } }))

const notice: Notice = {
  id: 'n1',
  workspaceId: 'w1',
  ts: 100,
  kind: 'digest',
  payload: {
    workspaceId: 'w1',
    windowStart: 0,
    windowEnd: 100,
    generatedAt: 100,
    policyVersion: 'abc123abc123',
    snapshot: {
      total: 3,
      unplanned: 0,
      todo: 0,
      running: 0,
      waiting: 1,
      review: 2,
      done: 0,
      closed: 0,
      attention: { needsApproval: 0, needsReply: 1, needsAttention: 0, needsReview: 2 },
    },
    ready: [
      {
        id: 't1',
        title: '待验收',
        status: 'review',
        attention: 'needs_review',
        waitingSince: 10,
        retryCount: 0,
      },
    ],
    blocked: [
      {
        id: 't2',
        title: '待回答',
        status: 'waiting_input',
        attention: 'needs_reply',
        waitingSince: 20,
        retryCount: 0,
      },
    ],
    dropped: [],
    changes: {
      created: 2,
      updated: 2,
      completed: 0,
      failed: 0,
      cancelled: 0,
      retried: 1,
      autoAllowed: 1,
      autoDenied: 0,
    },
    oldestWaiting: {
      id: 't2',
      title: '待回答',
      status: 'waiting_input',
      attention: 'needs_reply',
      waitingSince: 20,
      retryCount: 0,
    },
  },
  readAt: null,
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  vi.mocked(listNotices).mockResolvedValue({ notices: [] })
})

describe('DigestCard', () => {
  it('shows ready/blocked counts and marks read', async () => {
    const onRead = vi.fn()
    wrap(<DigestCard notice={notice} onRead={onRead} onOpenTask={() => {}} onGenerate={() => {}} />)

    expect(screen.getByText('待验收 2')).toBeInTheDocument()
    expect(screen.getByText('待处理 1')).toBeInTheDocument()
    expect(screen.getByText('最久等待：待回答')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '知道了' }))
    expect(onRead).toHaveBeenCalledWith('n1')
  })

  it('opens blocked tasks and generates a digest', async () => {
    const onOpenTask = vi.fn()
    const onGenerate = vi.fn()
    wrap(
      <DigestCard
        notice={notice}
        onOpenTask={onOpenTask}
        onGenerate={onGenerate}
        onRead={() => {}}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /待回答/ }))
    expect(onOpenTask).toHaveBeenCalledWith('t2')

    await userEvent.click(screen.getByRole('button', { name: '生成汇报' }))
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('shows an empty state without a notice', async () => {
    wrap(<DigestCard workspaceId="w1" onGenerate={() => {}} />)
    expect(await screen.findByText('还没有汇报')).toBeInTheDocument()
  })

  it('marks the digest unread while readAt is null', () => {
    wrap(<DigestCard notice={notice} onRead={() => {}} />)
    expect(screen.getByLabelText('未读')).toBeInTheDocument()
  })

  it('renders one attention item and applies a safe retry proposal', async () => {
    const onDecideAction = vi.fn().mockResolvedValue(undefined)
    wrap(
      <DigestCard
        notice={{
          ...notice,
          payload: {
            ...(notice.payload as Record<string, unknown>),
            attention: {
              items: [
                {
                  taskId: 't1',
                  title: '登录页修复',
                  kind: 'failed',
                  reason: '任务失败，建议重试',
                  waitingSince: 10,
                  proposalId: 'a1',
                  action: { type: 'apply_proposal', proposalId: 'a1' },
                },
              ],
              counts: { approval: 0, reply: 0, review: 0, failed: 1, stale: 0 },
            },
          },
        }}
        onDecideAction={onDecideAction}
        onOpenTask={() => {}}
        onGenerate={() => {}}
      />,
    )
    expect(screen.getByText('需要你决定')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '应用建议' }))
    expect(onDecideAction).toHaveBeenCalledWith('a1', 'apply')
  })

  it('hides the attention group when there is nothing for the human', () => {
    wrap(<DigestCard notice={notice} onOpenTask={() => {}} onGenerate={() => {}} />)
    expect(screen.queryByText('需要你决定')).toBeNull()
  })
})
