import type { Node } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { MobileNodeManager } from './MobileNodeManager'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))

const fileNode = {
  id: 'f1',
  canvasId: 'c1',
  type: 'file',
  x: 0,
  y: 0,
  w: 320,
  h: 200,
  groupId: null,
  createdAt: 1,
  updatedAt: 1,
  data: { name: '示例文件', path: 'src/example.ts' },
} as Node

beforeEach(() => {
  send.mockReset()
  send.mockResolvedValue({ nodeId: 'n1' })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/engines') {
        return Response.json({
          engines: [{ engine: 'claude-sdk', status: 'available' }],
        })
      }
      return Response.json({})
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderManager(nodes: Node[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <MobileNodeManager canvasId="c1" nodes={nodes} onClose={() => {}} />
      </CommandProvider>
    </QueryClientProvider>,
  )
}

it('does not offer manual text node creation', () => {
  renderManager()
  expect(screen.queryByRole('button', { name: '新建文本' })).toBeNull()
})

it('creates a file node with mime and validates the relative path', async () => {
  renderManager()

  await userEvent.click(screen.getByRole('button', { name: '新建文件' }))
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

  await userEvent.type(screen.getByLabelText('文件名称'), '示例文件')
  await userEvent.type(screen.getByLabelText('相对路径'), 'src/example.ts')
  await userEvent.type(screen.getByLabelText('MIME 类型（可选）'), 'text/plain')
  await userEvent.click(screen.getByRole('button', { name: '保存' }))

  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'node.create',
        payload: expect.objectContaining({
          node: expect.objectContaining({
            type: 'file',
            data: { name: '示例文件', path: 'src/example.ts', mime: 'text/plain' },
          }),
        }),
      }),
    ),
  )
})

it('keeps file nodes read-only', async () => {
  renderManager([fileNode])

  expect(screen.getByText('只读')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /示例文件/ })).not.toBeInTheDocument()
})

it('groups nodes by type', () => {
  const textNode = {
    ...fileNode,
    id: 't1',
    type: 'text',
    data: { content: '上下文' },
  } as Node
  renderManager([fileNode, textNode])

  expect(screen.getByRole('heading', { name: /文本 \(1\)/ })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /文件 \(1\)/ })).toBeInTheDocument()
})
