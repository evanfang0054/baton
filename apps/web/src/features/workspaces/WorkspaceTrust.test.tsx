import type { Workspace } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceTrustBadge } from './WorkspaceTrustBadge'
import { WorkspaceTrustDialog } from './WorkspaceTrustDialog'

const workspace: Workspace = {
  id: 'w1',
  name: 'demo',
  relPath: 'demo',
  trusted: false,
  projectHooks: 'off',
  trustedAt: null,
  createdAt: 1,
}

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
  return client
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('workspace trust UI', () => {
  it('trusts with hooks off by default and sends the PATCH payload', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init })
        return Response.json({ workspace: { ...workspace, trusted: true, trustedAt: 2 } })
      }),
    )
    wrap(<WorkspaceTrustDialog workspace={workspace} open onOpenChange={() => {}} />)

    expect(await screen.findByText('信任此工作区？')).toBeInTheDocument()
    expect(screen.getByText(/CLAUDE\.md/)).toBeInTheDocument()
    expect(screen.getByText(/审批卡不再是最终闸门/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '信任并加载' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]!.url).toBe('/api/workspaces/w1/trust')
    expect(calls[0]!.init).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ trusted: true, projectHooks: 'off' }),
    })
  })

  it('shows the badge and allows revoking trust', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input))
        return Response.json({ workspace: { ...workspace, trusted: false } })
      }),
    )
    wrap(
      <WorkspaceTrustBadge
        workspace={{ ...workspace, trusted: true, projectHooks: 'on', trustedAt: 2 }}
        onTrust={() => {}}
      />,
    )
    expect(screen.getByText('已信任')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '撤销信任' }))
    await waitFor(() => expect(calls).toEqual(['/api/workspaces/w1/trust']))
  })
})
