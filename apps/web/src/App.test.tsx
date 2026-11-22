import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { installMatchMedia } from './test/match-media'
import { useAppStore } from './stores/app'

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = 0
  sent: string[] = []
  private listeners = new Map<string, Array<(event: { code?: number }) => void>>()

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event: { code?: number }) => void) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }
}

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

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function stubEmptyApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ workspaces: [] })),
  )
}

function stubTaskApi() {
  const task = {
    id: 't1',
    workspaceId: 'w1',
    nodeId: 'n1',
    title: '修复登录页',
    prompt: '',
    status: 'waiting_input',
    waitingReason: 'question',
    engine: 'claude-sdk',
    workspaceMode: 'main',
    branch: null,
    worktreePath: null,
    verifyCommand: null,
    retryCount: 0,
    dangerouslySkipPermissions: false,
    budgetUsd: null,
    enqueuedAt: null,
    createdAt: 1,
    updatedAt: 2,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/workspaces')) {
        return json({
          workspaces: [
            {
              id: 'w1',
              name: 'demo',
              relPath: 'demo',
              trusted: false,
              projectHooks: 'off',
              trustedAt: null,
              createdAt: 1,
            },
          ],
        })
      }
      if (url.startsWith('/api/tasks?workspaceId=w1')) {
        return json({ tasks: [{ ...task, attention: 'needs_reply', waitingSince: 2 }] })
      }
      if (url.startsWith('/api/canvas?workspaceId=w1')) {
        return json({
          canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
          nodes: [],
          edges: [],
        })
      }
      if (url === '/api/tasks/t1') {
        return json({
          task,
          sessions: [],
          approvals: [],
          review: null,
          waitingSince: 2,
          attention: 'needs_reply',
          acceptance: null,
          budget: {
            budgetUsd: 2,
            spentUsd: 0,
            remainingUsd: 2,
            ratio: 0,
            overBudget: false,
            nearBudget: false,
            workerCostUsd: 0,
            verifierCostUsd: 0,
            turns: 0,
          },
        })
      }
      if (url === '/api/tasks/t1/automation') {
        return json({
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
  useAppStore.setState({
    activeWorkspaceId: null,
    activeTaskId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    contextNodeIds: [],
    boardExpanded: false,
    boardPinned: false,
    rightPanel: 'supervisor',
    wsStatus: 'offline',
    lastSeq: 0,
  })
  window.history.replaceState(null, '', '/')
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  stubEmptyApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App shell', () => {
  it('renders the mobile shell without canvas, rail or right panel', async () => {
    installMatchMedia(390)
    renderApp()

    expect(await screen.findByRole('navigation', { name: '移动端导航' })).toBeInTheDocument()
    expect(screen.getByTestId('mobile-board')).toBeInTheDocument()
    expect(screen.queryByTestId('canvas')).not.toBeInTheDocument()
    expect(screen.queryByTestId('board-rail')).not.toBeInTheDocument()
    expect(screen.queryByTestId('right-panel')).not.toBeInTheDocument()
  })

  it('renders the three-pane shell and empty workspace state', async () => {
    renderApp()
    expect(screen.getByText('baton')).toBeInTheDocument()
    expect(await screen.findByTestId('board-rail')).toBeInTheDocument()
    expect(screen.getByTestId('canvas')).toBeInTheDocument()
    expect(screen.getByTestId('right-panel')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '总管' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getAllByText('尚未选择工作区').length).toBeGreaterThan(0))
  })

  it('opens the create-workspace dialog', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: '新建工作区' }))
    expect(await screen.findByRole('heading', { name: '新建工作区' })).toBeInTheDocument()
    expect(screen.getByLabelText('工作区名称')).toBeInTheDocument()
    expect(screen.getByText('工作区目录')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择目录' })).toBeInTheDocument()
  })

  it('selects a workspace directory from the picker and fills the name', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/workspaces/browse')) {
          return json({
            path: '',
            parent: null,
            entries: [{ name: 'baton', relPath: 'Desktop/baton', hasGit: true }],
            truncated: false,
            searching: url.includes('q='),
          })
        }
        return json({ workspaces: [] })
      }),
    )
    renderApp()
    await user.click(await screen.findByRole('button', { name: '新建工作区' }))
    await user.click(screen.getByRole('button', { name: '选择目录' }))
    await user.click(await screen.findByRole('button', { name: '选择目录 Desktop/baton' }))

    expect(screen.getByText('Desktop/baton')).toBeInTheDocument()
    expect(screen.getByLabelText('工作区名称')).toHaveValue('baton')
  })

  it('searches directories and selects a nested result', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/workspaces/browse')) {
          const searching = url.includes('q=')
          return json({
            path: '',
            parent: null,
            entries: searching
              ? [{ name: 'baton', relPath: 'projects/baton-demo', hasGit: true }]
              : [{ name: 'Desktop', relPath: 'Desktop', hasGit: false }],
            truncated: false,
            searching,
          })
        }
        return json({ workspaces: [] })
      }),
    )
    renderApp()
    await user.click(await screen.findByRole('button', { name: '新建工作区' }))
    await user.click(screen.getByRole('button', { name: '选择目录' }))
    await screen.findByRole('button', { name: '选择目录 Desktop' })
    await user.type(screen.getByLabelText('搜索目录'), 'baton')
    await user.click(await screen.findByRole('button', { name: '选择目录 projects/baton-demo' }))

    expect(screen.getByText('projects/baton-demo')).toBeInTheDocument()
  })

  it('shows an unauthenticated hint when the API returns 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'unauthorized', message: 'unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    renderApp()
    expect(await screen.findByRole('alert')).toHaveTextContent('未认证')
  })

  it('selects a task and shows it in the detail panel', async () => {
    stubTaskApi()
    renderApp()
    fireEvent.click(screen.getByLabelText('展开看板'))
    fireEvent.click(await screen.findByText('修复登录页'))
    await waitFor(() => expect(screen.getByTestId('task-detail')).toHaveTextContent('修复登录页'))
  })

  it('restores workspace and task from the URL', async () => {
    stubTaskApi()
    window.history.replaceState(null, '', '/?workspace=w1&task=t1')
    renderApp()
    await waitFor(() => expect(screen.getByTestId('task-detail')).toHaveTextContent('修复登录页'))
  })

  it('removes task from the URL when the task selection is cleared', async () => {
    stubTaskApi()
    window.history.replaceState(null, '', '/?workspace=w1&task=t1')
    renderApp()
    await waitFor(() => expect(screen.getByTestId('task-detail')).toHaveTextContent('修复登录页'))
    act(() => useAppStore.getState().setTask(null))
    await waitFor(() => expect(new URLSearchParams(window.location.search).has('task')).toBe(false))
  })
})
