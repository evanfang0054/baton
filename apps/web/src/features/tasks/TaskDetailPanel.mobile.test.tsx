import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { useAppStore } from '../../stores/app'
import { TaskDetailPanel } from './TaskDetailPanel'

function stubDetail() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/tasks/t1') {
        return Response.json({
          task: {
            id: 't1',
            workspaceId: 'w1',
            nodeId: 'n1',
            title: '移动任务',
            prompt: '',
            status: 'todo',
            waitingReason: null,
            engine: 'fake',
            workspaceMode: 'main',
            branch: null,
            worktreePath: null,
            verifyCommand: null,
            dangerouslySkipPermissions: false,
            budgetUsd: null,
            enqueuedAt: null,
            retryCount: 0,
            createdAt: 1,
            updatedAt: 2,
            context: {
              included: [{ id: 'n1', type: 'text', title: '初始需求', depth: 0, chars: 4 }],
              dropped: [],
              truncated: false,
              redactedPaths: [],
              relations: [],
              relationsTruncated: false,
              injections: [
                {
                  seq: 1,
                  at: 1_700_000_000_000,
                  source: 'supervisor',
                  note: null,
                  nodeIds: ['n1'],
                  included: [{ id: 'n1', type: 'text', title: '初始需求', depth: 0, chars: 4 }],
                  dropped: [],
                  truncated: false,
                  relations: [],
                  relationsTruncated: false,
                  chars: 4,
                },
              ],
            },
            origin: null,
          },
          sessions: [],
          approvals: [],
          review: null,
          waitingSince: null,
          attention: 'none',
          contextInvalid: false,
          originInvalid: false,
        })
      }
      if (url === '/api/tasks/t1/automation') {
        return Response.json({
          taskId: 't1',
          retryCount: 0,
          lastVerifyExitCode: null,
          lastPolicyVersion: null,
          autoDecisions: [],
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
}

beforeEach(() => {
  useAppStore.setState({ activeWorkspaceId: 'w1', activeTaskId: 't1' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TaskDetailPanel mobile', () => {
  it('uses a scrollable layout with bounded transcript and sticky actions', async () => {
    stubDetail()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <CommandProvider send={vi.fn()}>
          <TaskDetailPanel mobile />
        </CommandProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('移动任务')).toBeInTheDocument()
    expect(screen.getByText('注入 #1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '投喂' })).not.toBeInTheDocument()
    expect(screen.getByTestId('mobile-task-scroll').className).toContain('overflow-y-auto')
    expect(screen.getByTestId('transcript-section').className).toContain('h-[45vh]')
    expect(screen.getByTestId('mobile-task-footer')).toHaveTextContent('任务已创建，尚未开工。')
    expect(screen.getByTestId('mobile-task-footer').className).toContain('shrink-0')
  })
})
