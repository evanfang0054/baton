import type { DeliverySummary, StageSummary } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DeliveryBoard, filterDeliveries } from './DeliveryBoard'

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
    status: 'draft',
    currentStageKey: 'requirement',
    stageProgress: { done: 0, total: 4 },
    stages: [
      stage(),
      stage({ key: 'design', label: '设计', ordinal: 2 }),
      stage({ key: 'build', label: '开发', ordinal: 3, gate: 'auto' }),
      stage({ key: 'acceptance', label: '验收', ordinal: 4 }),
    ],
    attention: 'none',
    waitingSince: null,
    openAnnotationCount: 0,
    createdAt: 1,
    updatedAt: 1,
    cancelledAt: null,
    ...overrides,
  }
}

describe('DeliveryBoard', () => {
  it('renders six columns and delivery cards with stage chips', () => {
    render(<DeliveryBoard deliveries={[delivery()]} onSelect={() => {}} />)
    for (const label of ['草稿', '进行中', '待我处理', '已阻断', '已交付', '已取消']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('优惠券领取页')).toBeInTheDocument()
    expect(screen.getByText('需求')).toBeInTheDocument()
    expect(screen.getByText('验收')).toBeInTheDocument()
    expect(screen.getByText(/0\/4 阶段/)).toBeInTheDocument()
  })

  it('filters needs-me and searches by title', async () => {
    const list = [
      delivery(),
      delivery({
        id: 'd2',
        title: '个人中心改版',
        status: 'waiting_person',
        attention: 'needs_review',
        waitingSince: 99,
      }),
    ]
    render(<DeliveryBoard deliveries={list} onSelect={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /需要我/ }))
    expect(screen.queryByText('优惠券领取页')).not.toBeInTheDocument()
    expect(screen.getByText('个人中心改版')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /全部/ }))
    await userEvent.type(screen.getByLabelText('搜索交付'), '优惠')
    expect(screen.getByText('优惠券领取页')).toBeInTheDocument()
    expect(screen.queryByText('个人中心改版')).not.toBeInTheDocument()
  })

  it('calls onSelect when a card is clicked', async () => {
    const onSelect = vi.fn()
    render(<DeliveryBoard deliveries={[delivery()]} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: '打开交付 优惠券领取页' }))
    expect(onSelect).toHaveBeenCalledWith('d1')
  })

  it('stops a delivery without opening the card', async () => {
    const onSelect = vi.fn()
    const onCancelDelivery = vi.fn()
    render(
      <DeliveryBoard
        deliveries={[delivery()]}
        onSelect={onSelect}
        onCancelDelivery={onCancelDelivery}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '停止交付 优惠券领取页' }))
    expect(onCancelDelivery).toHaveBeenCalledWith('d1')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('hides the stop action for cancelled deliveries', () => {
    render(
      <DeliveryBoard
        deliveries={[delivery({ status: 'cancelled' })]}
        onSelect={() => {}}
        onCancelDelivery={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /停止交付/ })).not.toBeInTheDocument()
  })

  it('sorts by waiting time and flags stale deliveries', () => {
    const now = Date.now()
    const sorted = filterDeliveries(
      [
        delivery({ id: 'new', waitingSince: now - 5 * 60_000 }),
        delivery({ id: 'old', waitingSince: now - 60 * 60_000, status: 'waiting_person' }),
      ],
      { filter: 'all', query: '' },
    )
    expect(sorted.map((item) => item.id)).toEqual(['old', 'new'])
  })
})
