import { afterEach, describe, expect, it } from 'vitest'
import { createDeliveryService } from '../src/delivery/service.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: Array<ReturnType<typeof createTestRuntime>> = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

function setup() {
  const handle = createTestRuntime()
  handles.push(handle)
  const service = createDeliveryService({
    db: handle.database.db,
    config: handle.config,
    now: handle.now,
    newId: handle.newId,
  })
  return { handle, service }
}

describe('delivery service', () => {
  it('creates a delivery canvas and first stage task', () => {
    const { handle, service } = setup()
    const result = service.createDelivery({
      workspaceId: handle.seeded.workspaceId,
      title: '优惠券领取页',
      goal: '做一个领取页',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)

    const detail = service.getDeliveryDetail(result.deliveryId)
    expect(detail?.stages).toHaveLength(4)
    expect(detail?.stages[0]).toMatchObject({ key: 'requirement', status: 'pending' })
    expect(detail?.currentStageKey).toBe('requirement')
    expect(detail?.status).toBe('draft')
    expect(detail?.stages[0]?.taskId).toBe(result.taskId)

    expect(service.listDeliveries(handle.seeded.workspaceId)).toHaveLength(1)
    expect(service.enqueueDelivery(result.deliveryId)).toEqual({ ok: true, taskId: result.taskId })
    expect(service.cancelDelivery(result.deliveryId)).toEqual({
      ok: true,
      taskId: result.taskId,
    })
    expect(service.getDeliveryDetail(result.deliveryId)?.status).toBe('cancelled')
  })
})
