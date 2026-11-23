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
    expect(service.cancelDelivery(result.deliveryId)).toEqual({ ok: true, taskId: null })
    expect(service.getDeliveryDetail(result.deliveryId)?.status).toBe('cancelled')
  })

  it('cascades a stage task cancel into delivery cancellation', () => {
    const { handle, service } = setup()
    const result = service.createDelivery({
      workspaceId: handle.seeded.workspaceId,
      title: '级联取消',
      goal: '验证阶段任务取消会取消整条交付',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)

    expect(
      handle.runtime.handleCommand({
        v: 1,
        id: 'cancel-stage',
        ts: 1,
        type: 'task.cancel',
        payload: { taskId: result.taskId },
      }).ok,
    ).toBe(true)
    const detail = service.getDeliveryDetail(result.deliveryId)
    expect(detail?.status).toBe('cancelled')
    expect(detail?.currentStageKey).toBeNull()
    expect(detail?.cancelledAt).not.toBeNull()
  })
})
