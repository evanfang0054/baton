import type { CanvasResponse, TaskDetailResponse, TaskSummary } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { useAppStore } from '../../stores/app'
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

const tasks: TaskSummary[] = [
  {
    id: 't1',
    workspaceId: 'w1',
    nodeId: null,
    title: '待办任务',
    prompt: '',
    status: 'todo',
    waitingReason: null,
    engine: 'fake',
    workspaceMode: 'main',
    branch: null,
    worktreePath: null,
    verifyCommand: null,
    retryCount: 0,
    dangerouslySkipPermissions: false,
    budgetUsd: null,
    enqueuedAt: null,
    createdAt: 1,
    updatedAt: 1,
    attention: 'none',
    waitingSince: null,
    acceptance: null,
    budget: null,
  },
]

const sceneDetail: TaskDetailResponse = {
  task: {
    id: 't1',
    workspaceId: 'w1',
    nodeId: null,
    title: '任务 A',
    prompt: '',
    status: 'running',
    waitingReason: null,
    engine: 'fake',
    workspaceMode: 'main',
    branch: null,
    worktreePath: null,
    verifyCommand: null,
    retryCount: 0,
    dangerouslySkipPermissions: false,
    budgetUsd: null,
    enqueuedAt: null,
    createdAt: 1,
    updatedAt: 1,
    context: {
      included: [{ id: 'n1', type: 'text', title: '画布里的文本', depth: 0, chars: 5 }],
      dropped: [],
      truncated: false,
      redactedPaths: [],
      relations: [],
      relationsTruncated: false,
      injections: [],
    },
    origin: null,
  },
  contextInvalid: false,
  originInvalid: false,
  sessions: [],
  approvals: [],
  review: null,
  waitingSince: null,
  attention: 'none',
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
}

afterEach(() => {
  useAppStore.setState({ sceneTaskId: null, selectedNodeIds: [] })
})

function renderPanel(
  send = vi.fn().mockResolvedValue({ nodeId: 'n-new' }),
  detail?: TaskDetailResponse,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (detail) client.setQueryData(queryKeys.task(detail.task.id), detail)
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
          onSelectNodes={vi.fn()}
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
            onSelectNodes={vi.fn()}
          />
        </CommandProvider>
      </QueryClientProvider>
    )
    const { rerender } = render(renderWith('n1'))
    await waitFor(() => expect(document.querySelector('.react-flow__node.selected')).toBeTruthy())
    rerender(renderWith(null))
    await waitFor(() => expect(document.querySelector('.react-flow__node.selected')).toBeNull())
  })

  it('creates a group from the current selection', async () => {
    useAppStore.setState({ selectedNodeIds: ['n1'] })
    const { send, ref } = renderPanel()
    ref.current?.addNode('group')
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'group.create',
        payload: {
          canvasId: 'c1',
          x: -14,
          y: -4,
          w: 368,
          h: 248,
          label: '新分组',
          childIds: ['n1'],
        },
      }),
    )
  })

  it('opens the image dialog from the toolbar action', async () => {
    const { send } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '添加图片' }))
    expect(await screen.findByRole('heading', { name: '添加图片节点' })).toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()
  })

  it('opens the inject dialog from the toolbar and submits selection', async () => {
    useAppStore.setState({ selectedNodeIds: ['n1'] })
    const { send } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '投喂给任务' }))
    expect(await screen.findByRole('heading', { name: '投喂给任务' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '投喂' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'context.inject',
        payload: { taskId: 't1', nodeIds: ['n1'] },
      }),
    )
  })

  it('enters scene, hides write actions, and exits without write commands', async () => {
    useAppStore.setState({ sceneTaskId: 't1' })
    const { send } = renderPanel(undefined, sceneDetail)

    expect(await screen.findByTestId('task-scene-bar')).toHaveTextContent('任务 A')
    expect(screen.getByText(/上下文 1 个/)).toBeInTheDocument()
    expect(screen.getByText(/已注入 0 次/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '投喂' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '添加文本' })).not.toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()

    fireEvent.doubleClick(screen.getByText('画布里的文本'))
    expect(screen.queryByRole('textbox', { name: '文本节点内容' })).not.toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '回到全局' }))
    await waitFor(() => expect(screen.queryByTestId('task-scene-bar')).not.toBeInTheDocument())
    expect(useAppStore.getState().sceneTaskId).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it('stays read-only and offers an exit while scene detail loads', async () => {
    useAppStore.setState({ sceneTaskId: 't1' })
    const { send } = renderPanel()

    expect(await screen.findByText('画布里的文本')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '添加文本' })).not.toBeInTheDocument()
    expect(screen.getByTestId('task-scene-loading')).toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('画布里的文本'))
    expect(screen.queryByRole('textbox', { name: '文本节点内容' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '回到全局' }))
    await waitFor(() => expect(screen.queryByTestId('task-scene-loading')).not.toBeInTheDocument())
    expect(useAppStore.getState().sceneTaskId).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })
})
