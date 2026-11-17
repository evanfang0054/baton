import type { TaskDetailResponse } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { useAppStore } from '../../stores/app'
import { TaskDetailPanel } from './TaskDetailPanel'

const baseTask: TaskDetailResponse['task'] = {
  id: 't1',
  workspaceId: 'w1',
  nodeId: 'n1',
  title: '修复登录页',
  prompt: '',
  status: 'todo',
  waitingReason: null,
  engine: 'fake',
  workspaceMode: 'main',
  branch: null,
  worktreePath: null,
  verifyCommand: null,
  retryCount: 0,
  createdAt: 1,
  updatedAt: 2,
}

function detail(overrides: Partial<TaskDetailResponse> = {}): TaskDetailResponse {
  return {
    task: baseTask,
    sessions: [
      {
        id: 's1',
        taskId: 't1',
        adapter: 'fake',
        engineSessionId: null,
        status: 'running',
        outcome: null,
        startedAt: 1,
        endedAt: null,
      },
    ],
    approvals: [],
    review: null,
    waitingSince: null,
    attention: 'none',
    ...overrides,
  }
}

function stubFetch(payload: TaskDetailResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/tasks/t1') return Response.json(payload)
      if (url.startsWith('/api/sessions/s1/events')) {
        return Response.json({
          sessionId: 's1',
          events: [
            {
              seq: 1,
              ts: 10,
              type: 'TEXT_MESSAGE_CONTENT',
              payload: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: '准备中' },
            },
          ],
          nextSeq: 1,
          hasMore: false,
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
}

function renderPanel(send = vi.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <TaskDetailPanel />
      </CommandProvider>
    </QueryClientProvider>,
  )
  return { send, client }
}

beforeEach(() => {
  useAppStore.setState({
    activeWorkspaceId: 'w1',
    activeTaskId: 't1',
    boardExpanded: false,
    boardPinned: false,
    wsStatus: 'offline',
    lastSeq: 0,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TaskDetailPanel', () => {
  it('shows a todo task, enqueues it and invalidates its queries', async () => {
    stubFetch(detail())
    const { send, client } = renderPanel()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    expect(await screen.findByText('修复登录页')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '立即开工' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'task.enqueue',
        payload: { taskId: 't1' },
      }),
    )
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.task('t1') }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tasks('w1') })
  })

  it('shows the approval gate for waiting_input', async () => {
    stubFetch(
      detail({
        task: { ...baseTask, status: 'waiting_input', waitingReason: 'approval' },
        attention: 'needs_approval',
        approvals: [
          {
            id: 'a1',
            sessionId: 's1',
            request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' },
            decision: null,
            decidedBy: null,
            decidedAt: null,
          },
        ],
      }),
    )
    const { send } = renderPanel()

    expect(await screen.findByText('需要授权')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '允许' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'approval.decide',
        payload: { approvalId: 'a1', decision: 'allow' },
      }),
    )
  })

  it('shows the reply composer for a question gate', async () => {
    stubFetch(
      detail({
        task: { ...baseTask, status: 'waiting_input', waitingReason: 'question' },
        attention: 'needs_reply',
      }),
    )
    renderPanel()

    expect(await screen.findByLabelText('回复内容')).toBeInTheDocument()
    expect(screen.queryByText('需要授权')).not.toBeInTheDocument()
  })

  it('shows the review card and read-only terminal state', async () => {
    const review = {
      id: 'r1',
      taskId: 't1',
      verdict: null,
      verifyExitCode: 0,
      verifyOutput: 'verify ok',
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      decidedAt: null,
    } as const
    stubFetch(
      detail({
        task: { ...baseTask, status: 'review' },
        attention: 'needs_review',
        review,
      }),
    )
    const { unmount } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CommandProvider send={vi.fn().mockResolvedValue(undefined)}>
          <TaskDetailPanel />
        </CommandProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('退出码 0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '通过' })).toBeInTheDocument()
    unmount()

    stubFetch(detail({ task: { ...baseTask, status: 'done' } }))
    renderPanel()
    expect(await screen.findByText('任务已结束，只读。')).toBeInTheDocument()
  })
})
