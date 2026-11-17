import type { Node as ProtocolNode, TaskSummary } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { CommandError } from '../../lib/ws'
import { NodePanel } from './NodePanel'

const agent: ProtocolNode = {
  id: 'n1',
  canvasId: 'c1',
  type: 'agent',
  x: 0,
  y: 0,
  w: 320,
  h: 200,
  groupId: null,
  data: { title: 'Agent 1', engine: 'fake', taskId: null },
  createdAt: 1,
  updatedAt: 1,
}

const task: TaskSummary = {
  id: 't1',
  workspaceId: 'w1',
  nodeId: 'n1',
  title: '演示任务',
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
  updatedAt: 1,
  attention: 'none',
  waitingSince: null,
}

function renderPanel(
  node: ProtocolNode,
  taskSummary: TaskSummary | null,
  send = vi.fn().mockResolvedValue(undefined),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onDeleted = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <NodePanel
          node={node}
          task={taskSummary}
          workspaceId="w1"
          onOpenTask={vi.fn()}
          onDeleted={onDeleted}
          onClose={vi.fn()}
        />
      </CommandProvider>
    </QueryClientProvider>,
  )
  return { send, onDeleted }
}

describe('NodePanel', () => {
  it('shows the create task form for an agent without a task', () => {
    renderPanel(agent, null)
    expect(screen.getByRole('heading', { name: '创建任务' })).toBeInTheDocument()
    expect(screen.getByLabelText('任务标题')).toBeInTheDocument()
  })

  it('shows the task summary for an agent with a task', () => {
    renderPanel(agent, task)
    expect(screen.getByText('已创建任务')).toBeInTheDocument()
    expect(screen.getByText('演示任务')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开任务' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '创建任务' })).not.toBeInTheDocument()
  })

  it('shows node_in_use when deleting a referenced node', async () => {
    const send = vi.fn().mockRejectedValue(new CommandError('node_in_use', 'node is referenced'))
    const { onDeleted } = renderPanel(agent, task, send)
    fireEvent.click(screen.getByRole('button', { name: '删除节点' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('节点被任务引用')
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('deletes an unreferenced node after confirmation', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const { onDeleted } = renderPanel(agent, null, send)
    fireEvent.click(screen.getByRole('button', { name: '删除节点' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'node.delete',
        payload: { nodeId: 'n1' },
      }),
    )
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
  })
})
