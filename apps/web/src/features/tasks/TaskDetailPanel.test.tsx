import type { TaskDetailResponse } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
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
  return send
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
  it('shows a todo task and enqueues it', async () => {
    stubFetch(detail())
    const send = renderPanel()

    expect(await screen.findByText('修复登录页')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '立即开工' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'task.enqueue',
        payload: { taskId: 't1' },
      }),
    )
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
    const send = renderPanel()

    expect(await screen.findByText('需要授权')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '允许' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'approval.decide',
        payload: { approvalId: 'a1', decision: 'allow' },
      }),
    )
  })
})
