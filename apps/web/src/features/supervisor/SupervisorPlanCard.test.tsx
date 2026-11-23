import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { getSupervisorAction } from '../../lib/api'
import { useAppStore } from '../../stores/app'
import { SupervisorPlanCard } from './SupervisorPlanCard'

vi.mock('../../lib/api', () => ({ getSupervisorAction: vi.fn() }))

const plan = {
  triggerId: 'trigger-1',
  source: { nodeIds: ['n1'] },
  templateId: 'bugfix' as const,
  contextDigest: [],
  items: [
    {
      title: '修复登录',
      templateId: 'bugfix' as const,
      targetNodeId: null,
      agentTitle: 'Agent 1',
      contextNodeIds: ['n1'],
      engine: null,
    },
  ],
}

function action(overrides: Record<string, unknown> = {}) {
  return {
    action: {
      id: 'a1',
      workspaceId: 'w1',
      threadId: 'th1',
      taskId: null,
      kind: 'triage_plan',
      status: 'proposed',
      strength: 'inferred',
      mode: 'observe',
      reason: '计划',
      payload: plan,
      result: null,
      policyVersion: 'p1',
      mandateVersion: null,
      dedupeKey: 'plan:1',
      createdAt: 1,
      updatedAt: 1,
      expiresAt: 100,
      appliedAt: null,
      ignoredAt: null,
      ...overrides,
    },
  }
}

function wrap(send = vi.fn().mockResolvedValue(undefined)) {
  useAppStore.setState({ activeWorkspaceId: 'w1' })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <SupervisorPlanCard actionId="a1" plan={plan} initialStatus="proposed" />
      </CommandProvider>
    </QueryClientProvider>,
  )
  return send
}

beforeEach(() => {
  vi.mocked(getSupervisorAction).mockResolvedValue(action() as never)
})

describe('SupervisorPlanCard', () => {
  it('shows template, context count and acceptance seed, then applies through WS', async () => {
    vi.mocked(getSupervisorAction).mockReset()
    vi.mocked(getSupervisorAction)
      .mockResolvedValueOnce(action() as never)
      .mockResolvedValue(
        action({
          status: 'applied',
          result: { createdTaskIds: ['t1'], failed: [] },
          appliedAt: 2,
        }) as never,
      )
    const send = wrap()
    expect(screen.getByText('修复')).toBeVisible()
    expect(screen.getByText('上下文 1 个')).toBeVisible()
    expect(screen.getByText(/复现步骤可执行/)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '应用全部' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'supervisor.action.decide',
        payload: { workspaceId: 'w1', actionId: 'a1', decision: 'apply' },
      }),
    )
  })

  it('shows a failed item and disables apply after expiry', async () => {
    vi.mocked(getSupervisorAction).mockResolvedValue(action({ status: 'expired' }) as never)
    wrap()
    expect(await screen.findByText('计划已过期')).toBeVisible()
    expect(screen.queryByRole('button', { name: '应用全部' })).toBeNull()
  })
})
