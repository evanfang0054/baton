import type { Node as ProtocolNode, ReviewView, TaskSummary } from '@baton/protocol'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CanvasActionsProvider, type CanvasActions } from '../actions'
import { GroupNode } from './GroupNode'
import { ImageNode } from './ImageNode'
import { ReviewCardNode } from './ReviewCardNode'
import { TextNode } from './TextNode'
import type { CanvasFlowNodeProps } from './NodeShell'

const review: ReviewView = {
  id: 'r1',
  taskId: 't1',
  verdict: null,
  verifyExitCode: 0,
  verifyOutput: 'ok',
  diffStat: { filesChanged: 3, insertions: 8, deletions: 2 },
  decidedAt: null,
  preliminaryVerdict: 'pass',
  preliminaryReason: '检查通过',
  preliminaryAt: 10,
  diffAvailable: true,
}

const task: TaskSummary = {
  id: 't1',
  workspaceId: 'w1',
  nodeId: 'a1',
  title: '登录页重构',
  prompt: '',
  status: 'review',
  waitingReason: null,
  engine: 'claude-sdk',
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
  attention: 'needs_review',
  waitingSince: 1,
  acceptance: null,
  budget: null,
}

function actions(overrides: Partial<CanvasActions> = {}): CanvasActions {
  return {
    readOnly: false,
    updatePosition: vi.fn(),
    updateSize: vi.fn(),
    updateContent: vi.fn(),
    updateGroupCollapsed: vi.fn(),
    openTask: vi.fn(),
    ...overrides,
  }
}

function props(
  node: ProtocolNode,
  data: Partial<CanvasFlowNodeProps['data']> = {},
): CanvasFlowNodeProps {
  return {
    id: node.id,
    type: node.type,
    data: { node, task: null, ...data },
    selected: false,
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: node.x,
    positionAbsoluteY: node.y,
  } as unknown as CanvasFlowNodeProps
}

function renderNode(element: ReactElement, handlers: Partial<CanvasActions> = {}) {
  return render(
    <ReactFlowProvider>
      <CanvasActionsProvider actions={actions(handlers)}>{element}</CanvasActionsProvider>
    </ReactFlowProvider>,
  )
}

describe('canvas nodes', () => {
  it('shows an injected badge with text, not color alone', () => {
    renderNode(<TextNode {...props(taskNode(), { injected: true })} />)
    expect(screen.getByText('已投喂')).toBeInTheDocument()
  })

  it('renders image with no-referrer and fallback', () => {
    const node: ProtocolNode = {
      ...taskNode(),
      id: 'i1',
      type: 'image',
      data: { src: '.baton/uploads/a.png', alt: '设计稿' },
    }
    renderNode(<ImageNode {...props(node, { imageUrl: '/api/workspaces/w1/uploads/a.png' })} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(img).toHaveAttribute('alt', '设计稿')
  })

  it('shows the image fallback after load error', () => {
    const node: ProtocolNode = {
      ...taskNode(),
      id: 'i1',
      type: 'image',
      data: { src: '.baton/uploads/a.png' },
    }
    renderNode(<ImageNode {...props(node, { imageUrl: '/missing.png' })} />)
    const img = screen.getByRole('img')
    fireEvent.error(img)
    expect(screen.getByText('图片无法加载')).toBeInTheDocument()
  })

  it('renders group child count and collapse button', () => {
    const node: ProtocolNode = {
      ...taskNode(),
      id: 'g1',
      type: 'group',
      data: { label: '需求区', collapsed: true },
    }
    const updateGroupCollapsed = vi.fn()
    renderNode(<GroupNode {...props(node, { childCount: 2 })} />, { updateGroupCollapsed })
    expect(screen.getByText('需求区')).toBeInTheDocument()
    expect(screen.getByText('2 个节点')).toBeInTheDocument()
    screen.getByRole('button', { name: '展开分组' }).click()
    expect(updateGroupCollapsed).toHaveBeenCalledWith('g1', false)
  })

  it('hides the group collapse control in a read-only scene', () => {
    const node: ProtocolNode = {
      ...taskNode(),
      id: 'g1',
      type: 'group',
      data: { label: '需求区', collapsed: false },
    }
    renderNode(<GroupNode {...props(node, { childCount: 2 })} />, { readOnly: true })
    expect(screen.getByText('已展开')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '折叠分组' })).not.toBeInTheDocument()
  })

  it('does not enter inline editing in a read-only scene', () => {
    const node: ProtocolNode = {
      ...taskNode(),
      type: 'text',
      data: { content: '现场只读文本' },
    }
    const updateContent = vi.fn()
    renderNode(<TextNode {...props(node)} />, { readOnly: true, updateContent })
    fireEvent.doubleClick(screen.getByText('现场只读文本'))
    expect(screen.queryByRole('textbox', { name: '文本节点内容' })).not.toBeInTheDocument()
    expect(updateContent).not.toHaveBeenCalled()
  })

  it('renders a read-only review card and opens the task', () => {
    const node: ProtocolNode = {
      ...taskNode(),
      id: 'review:t1',
      type: 'review',
      data: { taskId: 't1' },
    }
    const openTask = vi.fn()
    renderNode(<ReviewCardNode {...props(node, { task, review, childCount: undefined })} />, {
      openTask,
    })
    expect(screen.getByText('待验收')).toBeInTheDocument()
    expect(screen.getByText('初步验收：PASS')).toBeInTheDocument()
    expect(screen.getByText('最终由你决定')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '通过' })).not.toBeInTheDocument()
    screen.getByRole('button', { name: '打开任务 登录页重构' }).click()
    expect(openTask).toHaveBeenCalledWith('t1')
    screen.getByRole('button', { name: '查看证据' }).click()
    expect(openTask).toHaveBeenCalledTimes(2)
  })
})

function taskNode(): ProtocolNode {
  return {
    id: 'n1',
    canvasId: 'c1',
    type: 'text',
    x: 0,
    y: 0,
    w: 320,
    h: 200,
    groupId: null,
    data: { content: 'x' },
    createdAt: 1,
    updatedAt: 1,
  }
}
