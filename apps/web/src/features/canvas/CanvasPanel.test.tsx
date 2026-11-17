import type { CanvasResponse, TaskSummary } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { CanvasPanel, type CanvasPanelHandle } from './CanvasPanel'

const canvas: CanvasResponse = {
  canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
  nodes: [
    {
      id: 'n1',
      canvasId: 'c1',
      type: 'text',
      x: 10,
      y: 20,
      w: 320,
      h: 200,
      groupId: null,
      data: { content: '画布里的文本' },
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  edges: [],
}

const tasks: TaskSummary[] = []

function renderPanel(send = vi.fn().mockResolvedValue({ nodeId: 'n-new' })) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ref = createRef<CanvasPanelHandle>()
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <CanvasPanel
          ref={ref}
          canvas={canvas}
          tasks={tasks}
          selectedNodeId={null}
          onSelectNode={vi.fn()}
        />
      </CommandProvider>
    </QueryClientProvider>,
  )
  return { send, ref }
}

describe('CanvasPanel', () => {
  it('renders protocol nodes inside React Flow', async () => {
    renderPanel()
    expect(await screen.findByText('画布里的文本')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加 Agent' })).toBeInTheDocument()
  })

  it('creates an agent node from the imperative handle', async () => {
    const { send, ref } = renderPanel()
    ref.current?.addNode('agent')
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'node.create',
          payload: expect.objectContaining({
            canvasId: 'c1',
            node: expect.objectContaining({
              type: 'agent',
              data: expect.objectContaining({ engine: 'fake', title: 'Agent 1' }),
            }),
          }),
        }),
      ),
    )
  })

  it('clears the flow selection when selectedNodeId becomes null', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const ref = createRef<CanvasPanelHandle>()
    const renderWith = (selectedNodeId: string | null) => (
      <QueryClientProvider client={client}>
        <CommandProvider send={vi.fn()}>
          <CanvasPanel
            ref={ref}
            canvas={canvas}
            tasks={tasks}
            selectedNodeId={selectedNodeId}
            onSelectNode={vi.fn()}
          />
        </CommandProvider>
      </QueryClientProvider>
    )
    const { rerender } = render(renderWith('n1'))
    await waitFor(() => expect(document.querySelector('.react-flow__node.selected')).toBeTruthy())
    rerender(renderWith(null))
    await waitFor(() => expect(document.querySelector('.react-flow__node.selected')).toBeNull())
  })
})
