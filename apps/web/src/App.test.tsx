import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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
})
