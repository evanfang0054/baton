import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ workspaces: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  )
})

describe('App shell', () => {
  it('renders the three-pane shell and empty workspace state', async () => {
    renderApp()
    expect(screen.getByText('baton')).toBeInTheDocument()
    expect(await screen.findByTestId('board-rail')).toBeInTheDocument()
    expect(screen.getByTestId('canvas')).toBeInTheDocument()
    expect(screen.getByTestId('task-detail')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('尚未选择工作区')).toBeInTheDocument())
  })

  it('opens the create-workspace dialog', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: '新建工作区' }))
    expect(await screen.findByRole('heading', { name: '新建工作区' })).toBeInTheDocument()
  })

  it('selects a task and shows it in the detail panel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/workspaces')) {
          return Response.json({
            workspaces: [{ id: 'w1', name: 'demo', relPath: 'demo', createdAt: 1 }],
          })
        }
        if (url.startsWith('/api/tasks?workspaceId=w1')) {
          return Response.json({
            tasks: [
              {
                id: 't1',
                workspaceId: 'w1',
                nodeId: 'n1',
                title: '修复登录页',
                prompt: '',
                status: 'waiting_input',
                waitingReason: 'question',
                engine: 'fake',
                workspaceMode: 'main',
                branch: null,
                worktreePath: null,
                verifyCommand: null,
                retryCount: 0,
                createdAt: 1,
                updatedAt: 2,
                attention: 'needs_reply',
                waitingSince: 2,
              },
            ],
          })
        }
        if (url.startsWith('/api/canvas?workspaceId=w1')) {
          return Response.json({
            canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
            nodes: [],
            edges: [],
          })
        }
        if (url === '/api/tasks/t1') {
          return Response.json({
            task: {
              id: 't1',
              workspaceId: 'w1',
              nodeId: 'n1',
              title: '修复登录页',
              prompt: '',
              status: 'waiting_input',
              waitingReason: 'question',
              engine: 'fake',
              workspaceMode: 'main',
              branch: null,
              worktreePath: null,
              verifyCommand: null,
              retryCount: 0,
              createdAt: 1,
              updatedAt: 2,
            },
            sessions: [],
            approvals: [],
            review: null,
            waitingSince: 2,
            attention: 'needs_reply',
          })
        }
        throw new Error(`unexpected fetch ${url}`)
      }),
    )
    renderApp()
    fireEvent.click(screen.getByLabelText('展开看板'))
    fireEvent.click(await screen.findByText('修复登录页'))
    await waitFor(() => expect(screen.getByTestId('task-detail')).toHaveTextContent('修复登录页'))
  })
})
