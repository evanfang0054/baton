import type { TaskDetailResponse, TaskSummary } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { SupervisorGateCards } from './SupervisorGateCards'

const now = Date.now()

function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 't1',
    workspaceId: 'w1',
    nodeId: null,
    title: '登录页修复',
    prompt: '',
    status: 'waiting_input',
    waitingReason: 'approval',
    engine: 'claude-sdk',
    workspaceMode: 'main',
    branch: null,
    worktreePath: null,
    verifyCommand: null,
    retryCount: 0,
    dangerouslySkipPermissions: false,
    enqueuedAt: null,
    createdAt: 1,
    updatedAt: 2,
    attention: 'needs_approval',
    waitingSince: now - 60_000,
    acceptance: null,
    ...overrides,
  } as TaskSummary
}

function detail(overrides: Partial<TaskDetailResponse> = {}): TaskDetailResponse {
  return {
    task: { ...task(), context: null, origin: null },
    contextInvalid: false,
    originInvalid: false,
    sessions: [],
    approvals: [],
    review: null,
    waitingSince: now - 60_000,
    attention: 'needs_approval',
    acceptance: null,
    lastFailure: null,
    lastOutcome: null,
    ...overrides,
  } as TaskDetailResponse
}

function stubFetch(tasks: TaskSummary[], taskDetail: TaskDetailResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/tasks?')) return Response.json({ tasks })
      if (url === '/api/tasks/t1') return Response.json(taskDetail)
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
}

function renderCards(send = vi.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <SupervisorGateCards workspaceId="w1" onOpenTask={() => {}} />
      </CommandProvider>
    </QueryClientProvider>,
  )
  return send
}

afterEach(() => vi.unstubAllGlobals())

describe('SupervisorGateCards', () => {
  it('allows a pending approval once from the supervisor chat', async () => {
    const approval = {
      id: 'a1',
      sessionId: 's1',
      request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'high' as const },
      decision: null,
      decidedBy: null,
      decidedAt: null,
      response: null,
    }
    stubFetch([task()], detail({ approvals: [approval] }))
    const send = renderCards()

    expect(await screen.findByText('待我处理 1')).toBeInTheDocument()
    expect(screen.getByText('登录页修复')).toBeInTheDocument()
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('高风险')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '允许' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'approval.decide',
        payload: { approvalId: 'a1', decision: 'allow' },
      }),
    )
    expect(send).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText('登录页修复')).not.toBeInTheDocument())
  })

  it('denies a pending approval from the supervisor chat', async () => {
    const approval = {
      id: 'a1',
      sessionId: 's1',
      request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'high' as const },
      decision: null,
      decidedBy: null,
      decidedAt: null,
      response: null,
    }
    stubFetch([task()], detail({ approvals: [approval] }))
    const send = renderCards()

    fireEvent.click(await screen.findByRole('button', { name: '拒绝' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'approval.decide',
        payload: { approvalId: 'a1', decision: 'deny' },
      }),
    )
  })

  it('does not expose AskUserQuestion approvals as normal gate cards', async () => {
    stubFetch(
      [task()],
      detail({
        approvals: [
          {
            id: 'q1',
            sessionId: 's1',
            request: {
              toolName: 'AskUserQuestion',
              input: { questions: [{ question: '选哪个？', options: [] }] },
              risk: 'high',
            },
            decision: null,
            decidedBy: null,
            decidedAt: null,
            response: null,
          },
        ],
      }),
    )
    renderCards()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByText(/待我处理/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '允许' })).not.toBeInTheDocument()
  })

  it('shows the total count while rendering only the first four cards', async () => {
    const tasks = Array.from({ length: 5 }, (_, index) =>
      task({ id: `t${index + 1}`, title: `任务 ${index + 1}` }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/tasks?')) return Response.json({ tasks })
        const id = url.match(/^\/api\/tasks\/(.+)$/)?.[1]
        if (id) {
          return Response.json(
            detail({
              task: { ...task({ id, title: `任务 ${id.slice(1)}` }), context: null, origin: null },
              approvals: [
                {
                  id: `a-${id}`,
                  sessionId: 's1',
                  request: { toolName: 'Bash', input: {}, risk: 'low' },
                  decision: null,
                  decidedBy: null,
                  decidedAt: null,
                  response: null,
                },
              ],
            }),
          )
        }
        throw new Error(`unexpected fetch ${url}`)
      }),
    )
    renderCards()

    expect(await screen.findByText(/待我处理 5/)).toBeInTheDocument()
    expect(screen.getByText(/显示前 4/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '允许' })).toHaveLength(4)
  })

  it('requires an override reason before approving a failed acceptance', async () => {
    const review = {
      id: 'r1',
      taskId: 't1',
      verdict: null,
      verifyExitCode: 1,
      verifyOutput: 'FAIL',
      diffStat: { filesChanged: 2, insertions: 8, deletions: 1 },
      decidedAt: null,
      diffAvailable: false,
      preliminaryVerdict: 'fail' as const,
      preliminaryReason: null,
      preliminaryAt: null,
    }
    const acceptance = {
      contractId: 'ac1',
      version: 1,
      revision: 0,
      status: 'draft' as const,
      counts: { total: 2, pass: 1, fail: 1, pending: 0, waived: 0 },
      verdict: 'fail' as const,
      topFailures: [{ text: '错误提示', evidence: null }],
    }
    stubFetch(
      [task({ status: 'review', waitingReason: null, attention: 'needs_review' })],
      detail({
        task: { ...task({ status: 'review', waitingReason: null }), context: null, origin: null },
        attention: 'needs_review',
        review,
        acceptance,
      }),
    )
    const send = renderCards()

    expect(await screen.findByText('待我处理 1')).toBeInTheDocument()
    expect(screen.getByText(/退出码 1/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '通过' }))
    const confirm = screen.getByRole('button', { name: '确认通过' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('通过理由'), { target: { value: '已知风险' } })
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'approve', overrideReason: '已知风险' },
      }),
    )
  })

  it('requires reject feedback and hides already decided reviews', async () => {
    const review = {
      id: 'r1',
      taskId: 't1',
      verdict: null,
      verifyExitCode: 0,
      verifyOutput: 'ok',
      diffStat: { filesChanged: 1, insertions: 1, deletions: 0 },
      decidedAt: null,
      diffAvailable: false,
      preliminaryVerdict: 'pass' as const,
      preliminaryReason: null,
      preliminaryAt: null,
    }
    stubFetch(
      [task({ status: 'review', waitingReason: null, attention: 'needs_review' })],
      detail({
        task: { ...task({ status: 'review', waitingReason: null }), context: null, origin: null },
        attention: 'needs_review',
        review,
      }),
    )
    const send = renderCards()

    fireEvent.click(await screen.findByRole('button', { name: '打回' }))
    const confirm = screen.getByRole('button', { name: '确认打回' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('打回反馈'), { target: { value: '补测试' } })
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'reject', feedback: '补测试' },
      }),
    )
  })

  it('does not render a gate without a pending approval or review', async () => {
    stubFetch(
      [task()],
      detail({
        approvals: [
          {
            id: 'a1',
            sessionId: 's1',
            request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'high' },
            decision: 'allow',
            decidedBy: 'user',
            decidedAt: 3,
            response: null,
          },
        ],
      }),
    )
    renderCards()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByText(/待我处理/)).not.toBeInTheDocument()
  })
})
