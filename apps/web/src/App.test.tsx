import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
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
    engine: 'fake',
    workspaceMode: 'main',
    branch: null,
    worktreePath: null,
    verifyCommand: null,
    retryCount: 0,
    createdAt: 1,
    updatedAt: 2,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/workspaces')) {
        return json({ workspaces: [{ id: 'w1', name: 'demo', relPath: 'demo', createdAt: 1 }] })
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
    boardExpanded: false,
    boardPinned: false,
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
    expect(screen.getByLabelText('工作区名称')).toBeInTheDocument()
    expect(screen.getByLabelText('工作区相对路径')).toBeInTheDocument()
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
})
