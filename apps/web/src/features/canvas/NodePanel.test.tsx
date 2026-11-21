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
  dangerouslySkipPermissions: false,
  budgetUsd: null,
  enqueuedAt: null,
  retryCount: 0,
  createdAt: 1,
  updatedAt: 1,
  attention: 'none',
  waitingSince: null,
  acceptance: null,
  budget: null,
}

function renderPanel(
  node: ProtocolNode,
  taskSummary: TaskSummary | null,
  send = vi.fn().mockResolvedValue(undefined),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onDeleted = vi.fn()
  const view = render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <NodePanel
          node={node}
          task={taskSummary}
          workspaceId="w1"
          workspaceTrusted={false}
          contextNodes={[]}
          onOpenTask={vi.fn()}
          onDeleted={onDeleted}
          onClose={vi.fn()}
        />
      </CommandProvider>
    </QueryClientProvider>,
  )
  const rerender = (nextNode: ProtocolNode, nextTask: TaskSummary | null) =>
    view.rerender(
      <QueryClientProvider client={client}>
        <CommandProvider send={send}>
          <NodePanel
            node={nextNode}
            task={nextTask}
            workspaceId="w1"
            workspaceTrusted={false}
            contextNodes={[]}
            onOpenTask={vi.fn()}
            onDeleted={onDeleted}
            onClose={vi.fn()}
          />
        </CommandProvider>
      </QueryClientProvider>,
    )
  return { send, onDeleted, rerender }
}

describe('NodePanel', () => {
  it('edits text node content', async () => {
    const textNode: ProtocolNode = {
      ...agent,
      id: 'n-text',
      type: 'text',
      data: { content: '原始上下文' },
    }
    const send = vi.fn().mockResolvedValue(undefined)
    renderPanel(textNode, null, send)

    const input = screen.getByLabelText('文本内容')
    expect(input).toHaveValue('原始上下文')
    fireEvent.change(input, { target: { value: '新的上下文' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'node.update',
        payload: { nodeId: 'n-text', patch: { data: { content: '新的上下文' } } },
      }),
    )
  })

  it('edits agent node title', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    renderPanel(agent, null, send)

    const input = screen.getByLabelText('节点标题')
    expect(input).toHaveValue('Agent 1')
    fireEvent.change(input, { target: { value: '研究 Agent' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'node.update',
        payload: { nodeId: 'n1', patch: { data: { title: '研究 Agent' } } },
      }),
    )
  })

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

  it('offers a new task form after the latest task reaches a terminal state', () => {
    renderPanel(agent, { ...task, status: 'done' })
    expect(screen.getByText('已创建任务')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '创建任务' })).toBeInTheDocument()
  })

  it('clears delete confirmation when selecting another node', () => {
    const other = { ...agent, id: 'n2', data: { ...agent.data, title: 'Agent 2' } }
    const { rerender } = renderPanel(agent, task)
    fireEvent.click(screen.getByRole('button', { name: '删除节点' }))
    expect(screen.getByText('确认删除这个节点？')).toBeInTheDocument()

    rerender(other, { ...task, id: 't2', nodeId: 'n2' })
    expect(screen.queryByText('确认删除这个节点？')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除节点' })).toBeInTheDocument()
  })

  it('edits image alt text', async () => {
    const image: ProtocolNode = {
      ...agent,
      id: 'n-image',
      type: 'image',
      data: { src: '.baton/uploads/a.png', alt: '旧描述' },
    }
    const send = vi.fn().mockResolvedValue(undefined)
    renderPanel(image, null, send)

    expect(screen.getByText('.baton/uploads/a.png')).toBeInTheDocument()
    const input = screen.getByLabelText('图片描述')
    fireEvent.change(input, { target: { value: '新描述' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'node.update',
        payload: { nodeId: 'n-image', patch: { data: { alt: '新描述' } } },
      }),
    )
  })

  it('edits group label and toggles collapse', async () => {
    const group: ProtocolNode = {
      ...agent,
      id: 'n-group',
      type: 'group',
      data: { label: '需求区', collapsed: false },
    }
    const send = vi.fn().mockResolvedValue(undefined)
    renderPanel(group, null, send)

    expect(screen.getByText('0 个节点')).toBeInTheDocument()
    const input = screen.getByLabelText('分组名称')
    fireEvent.change(input, { target: { value: '交付区' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'node.update',
        payload: { nodeId: 'n-group', patch: { data: { label: '交付区' } } },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '折叠分组' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'node.update',
        payload: { nodeId: 'n-group', patch: { data: { collapsed: true } } },
      }),
    )
  })
})
