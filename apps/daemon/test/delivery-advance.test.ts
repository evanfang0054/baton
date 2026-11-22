import { afterEach, describe, expect, it } from 'vitest'
import { createArtifactService } from '../src/artifact/service.js'
import { createDeliveryService } from '../src/delivery/service.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: Array<ReturnType<typeof createTestRuntime>> = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

function setup() {
  const handle = createTestRuntime()
  handles.push(handle)
  const deliveries = createDeliveryService({
    db: handle.database.db,
    config: handle.config,
    now: handle.now,
    newId: handle.newId,
  })
  const artifacts = createArtifactService({
    db: handle.database.db,
    config: handle.config,
    now: handle.now,
    newId: handle.newId,
  })
  const created = deliveries.createDelivery({
    workspaceId: handle.seeded.workspaceId,
    title: '优惠券领取页',
    goal: '做一个领取页',
  })
  if (!created.ok) throw new Error(created.message)
  return { deliveries, artifacts, deliveryId: created.deliveryId }
}

describe('delivery advance', () => {
  it('creates the next stage once and accepts current artifacts', () => {
    const { deliveries, artifacts, deliveryId } = setup()
    const draft = artifacts.createDraftArtifact({
      deliveryId,
      stageKey: 'requirement',
      kind: 'spec',
      name: 'spec.md',
    })

    const first = deliveries.advanceDelivery(deliveryId, 'requirement')
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    expect(first.nextTaskId).toBeTruthy()

    const detail = deliveries.getDeliveryDetail(deliveryId)
    expect(detail?.stages[1]?.taskId).toBe(first.nextTaskId)
    expect(artifacts.listArtifacts(deliveryId).find((item) => item.id === draft.id)?.status).toBe(
      'accepted',
    )

    const second = deliveries.advanceDelivery(deliveryId, 'requirement')
    expect(second).toEqual(first)
  })
})
