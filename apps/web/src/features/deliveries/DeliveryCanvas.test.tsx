import type { DeliveryDetail } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DeliveryCanvas } from './DeliveryCanvas'

vi.mock('../canvas/CanvasPanel', () => ({
  CanvasPanel: () => <div data-testid="canvas" />,
}))

function delivery(overrides: Partial<DeliveryDetail> = {}): DeliveryDetail {
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
    stageProgress: { done: 0, total: 1 },
    stages: [
      {
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
      },
    ],
    attention: 'none',
    waitingSince: null,
    openAnnotationCount: 0,
    annotations: [],
    createdAt: 1,
    updatedAt: 1,
    cancelledAt: null,
    ...overrides,
  } as DeliveryDetail
}

function renderCanvas(input: DeliveryDetail, onCancelDelivery = vi.fn()) {
  render(
    <DeliveryCanvas
      workspaceId="w1"
      workspaceTrusted={false}
      delivery={input}
      canvas={null}
      tasks={[]}
      artifacts={[]}
      selectedNodeId={null}
      onSelectNode={() => {}}
      onSelectNodes={() => {}}
      onOpenTask={() => {}}
      onOpenArtifact={() => {}}
      onOpenDrawing={() => {}}
      onOpenAnnotations={() => {}}
      onCreateDrawing={() => {}}
      onAnnotationsChanged={() => {}}
      onOpenAcceptance={() => {}}
      onCancelDelivery={onCancelDelivery}
    />,
  )
  return { onCancelDelivery }
}

describe('DeliveryCanvas', () => {
  it('calls onCancelDelivery from the top card', async () => {
    const { onCancelDelivery } = renderCanvas(delivery())
    await userEvent.click(screen.getByRole('button', { name: '停止交付' }))
    expect(onCancelDelivery).toHaveBeenCalledWith('d1')
  })

  it('hides stop delivery after cancellation', () => {
    renderCanvas(delivery({ status: 'cancelled', cancelledAt: 2 }))
    expect(screen.queryByRole('button', { name: '停止交付' })).not.toBeInTheDocument()
  })
})
