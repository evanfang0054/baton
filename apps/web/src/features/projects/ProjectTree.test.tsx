import type {
  AttentionInboxItem,
  AttentionInboxResponse,
  DeliverySummary,
  StageSummary,
  Workspace,
} from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listDeliveries } from '../../lib/api'
import { ProjectTree } from './ProjectTree'

vi.mock('../../lib/api', () => ({ listDeliveries: vi.fn() }))

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'w1',
    name: 'demo',
    relPath: 'demo',
    trusted: true,
    projectHooks: 'off',
    trustedAt: null,
    createdAt: 1,
    ...overrides,
  }
}

function stage(overrides: Partial<StageSummary> = {}): StageSummary {
  return {
    key: 'requirement',
    label: '需求',
    ordinal: 1,
    gate: 'human',
    status: 'pending',
    taskId: null,
    taskStatus: null,
    attention: 'none',
    waitingSince: null,
    artifactCount: 0,
    openAnnotationCount: 0,
    skillId: null,
    skillStatus: null,
    ...overrides,
  }
}

function delivery(overrides: Partial<DeliverySummary> = {}): DeliverySummary {
  return {
    id: 'd1',
    workspaceId: 'w1',
    canvasId: 'c1',
    title: '优惠券领取页',
    goal: '做一个可用的领取页',
    playbookId: 'standard-delivery',
    playbookVersion: 1,
    status: 'waiting_person',
    currentStageKey: 'requirement',
    stageProgress: { done: 0, total: 1 },
    stages: [stage()],
    attention: 'needs_review',
    waitingSince: 10,
    openAnnotationCount: 0,
    createdAt: 1,
    updatedAt: 1,
    cancelledAt: null,
    ...overrides,
  }
}

function attentionItem(overrides: Partial<AttentionInboxItem> = {}): AttentionInboxItem {
  return {
    workspaceId: 'w1',
    workspaceName: 'demo',
    deliveryId: 'd1',
    deliveryTitle: '优惠券领取页',
    stageKey: 'requirement',
    taskId: 't1',
    title: '待验收',
    kind: 'needs_review',
    waitingSince: 10,
    ...overrides,
  }
}

function renderTree(
  overrides: Partial<{
    workspaces: Workspace[]
    attention: AttentionInboxResponse | null
    activeWorkspaceId: string | null
    activeDeliveryId: string | null
    deliveryView: 'canvas' | 'board'
    onCreateProject: () => void
    onCreateDelivery: (workspaceId: string) => void
    onOpenBoard: (workspaceId: string) => void
    onOpenDelivery: (workspaceId: string, deliveryId: string) => void
    onOpenAttention: (item: AttentionInboxItem) => void
  }> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const props = {
    workspaces: [workspace()],
    attention: { items: [], total: 0 } satisfies AttentionInboxResponse,
    activeWorkspaceId: 'w1',
    activeDeliveryId: null,
    deliveryView: 'canvas' as const,
    onCreateProject: vi.fn(),
    onCreateDelivery: vi.fn(),
    onOpenBoard: vi.fn(),
    onOpenDelivery: vi.fn(),
    onOpenAttention: vi.fn(),
    ...overrides,
  }
  render(
    <QueryClientProvider client={client}>
      <ProjectTree {...props} />
    </QueryClientProvider>,
  )
  return props
}

describe('ProjectTree', () => {
  beforeEach(() => {
    vi.mocked(listDeliveries).mockReset()
    vi.mocked(listDeliveries).mockResolvedValue([delivery()])
  })

  it('renders the project tree without all-projects or project-canvas entries', async () => {
    renderTree()
    expect(screen.getByText('通知 0')).toBeInTheDocument()
    expect(screen.getByText('项目')).toBeInTheDocument()
    expect(screen.queryByText('全部项目')).not.toBeInTheDocument()
    expect(screen.queryByText('项目画布')).not.toBeInTheDocument()
    expect(await screen.findByText('优惠券领取页')).toBeInTheDocument()
  })

  it('expands only the active project initially and lazily loads another project', async () => {
    renderTree({
      workspaces: [workspace(), workspace({ id: 'w2', name: 'beta', relPath: 'beta' })],
    })
    expect(listDeliveries).toHaveBeenCalledTimes(1)
    expect(listDeliveries).toHaveBeenCalledWith('w1')

    await userEvent.click(screen.getByRole('button', { name: '展开项目 beta' }))
    await waitFor(() => expect(listDeliveries).toHaveBeenCalledWith('w2'))
    expect(listDeliveries).toHaveBeenCalledTimes(2)
  })

  it('opens a requirement, its board and a new requirement from the project group', async () => {
    const props = renderTree()
    await userEvent.click(await screen.findByRole('button', { name: '打开交付 优惠券领取页' }))
    expect(props.onOpenDelivery).toHaveBeenCalledWith('w1', 'd1')

    await userEvent.click(screen.getByRole('button', { name: '需求看板' }))
    expect(props.onOpenBoard).toHaveBeenCalledWith('w1')

    await userEvent.click(screen.getByRole('button', { name: '新建需求' }))
    expect(props.onCreateDelivery).toHaveBeenCalledWith('w1')
  })

  it('shows attention items, project dots and opens the task scene', async () => {
    const item = attentionItem()
    const props = renderTree({ attention: { items: [item], total: 1 } })
    expect(screen.getByText('通知 1')).toBeInTheDocument()
    expect(screen.getByLabelText('有通知')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'demo 优惠券领取页 待验收' }),
    )
    expect(props.onOpenAttention).toHaveBeenCalledWith(item)
  })

  it('shows the empty attention copy and creates a project from the header', async () => {
    const props = renderTree()
    expect(screen.getByText('没有需要你处理的')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '新建项目' }))
    expect(props.onCreateProject).toHaveBeenCalledTimes(1)
  })
})
