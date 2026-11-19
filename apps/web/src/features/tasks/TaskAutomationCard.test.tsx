import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTaskAutomation } from '../../lib/api'
import { TaskAutomationCard } from './TaskAutomationCard'

vi.mock('../../lib/api', () => ({ getTaskAutomation: vi.fn() }))

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TaskAutomationCard taskId="t1" />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.mocked(getTaskAutomation).mockReset())

describe('TaskAutomationCard', () => {
  it('renders auto approval and retry count without prompt', async () => {
    vi.mocked(getTaskAutomation).mockResolvedValue({
      taskId: 't1',
      retryCount: 1,
      lastVerifyExitCode: 1,
      lastPolicyVersion: 'abc123abc123',
      autoDecisions: [
        {
          approvalId: 'a1',
          decision: 'allow',
          toolName: 'Bash',
          risk: 'low',
          decidedAt: 10,
          policyVersion: 'abc123abc123',
        },
      ],
    })
    wrap()

    expect(await screen.findByText('自动批准 1 次')).toBeInTheDocument()
    expect(screen.getByText('自动重试 1 次')).toBeInTheDocument()
    expect(screen.getByText('最近验收退出码 1')).toBeInTheDocument()
    expect(screen.getByText('自动批准 · Bash · low')).toBeInTheDocument()
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument()
  })

  it('shows the empty state when no automatic decision happened', async () => {
    vi.mocked(getTaskAutomation).mockResolvedValue({
      taskId: 't1',
      retryCount: 0,
      lastVerifyExitCode: null,
      lastPolicyVersion: null,
      autoDecisions: [],
    })
    wrap()

    expect(await screen.findByText('本任务没有自动决策')).toBeInTheDocument()
    expect(screen.getByText('自动批准 0 次')).toBeInTheDocument()
  })

  it('shows an error state when the record cannot be loaded', async () => {
    vi.mocked(getTaskAutomation).mockRejectedValue(new Error('boom'))
    wrap()

    expect(await screen.findByRole('alert')).toHaveTextContent('自动化记录加载失败')
  })
})
