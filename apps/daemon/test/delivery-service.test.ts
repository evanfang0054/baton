import { afterEach, describe, expect, it } from 'vitest'
import {
  insertAnnotation,
  insertArtifact,
  listAnnotations,
  listArtifactsByDelivery,
} from '../src/db/delivery-repositories.js'
import { insertTask } from '../src/db/repositories.js'
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
    expect(
      service.markDeliveryCancelled(result.deliveryId, {
        actor: 'human',
        source: 'delivery_cancel',
      }),
    ).toEqual({ ok: true, changed: true, taskId: result.taskId })
    expect(
      service.markDeliveryCancelled(result.deliveryId, {
        actor: 'human',
        source: 'delivery_cancel',
      }),
    ).toEqual({ ok: true, changed: false, taskId: null })
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
    const deliveryId = result.deliveryId
    handle.database.db.transaction((tx) =>
      insertArtifact(tx, {
        id: 'art-1',
        workspaceId: handle.seeded.workspaceId,
        deliveryId,
        stageKey: 'requirement',
        taskId: result.taskId,
        kind: 'spec',
        name: 'spec.md',
        path: `.baton/deliveries/${deliveryId}/requirement/spec.md`,
        sourcePath: null,
        svgPath: null,
        mime: 'text/markdown',
        size: 10,
        sha256: 'sha-1',
        version: 1,
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
      }),
    )
    handle.database.db.transaction((tx) =>
      insertAnnotation(tx, {
        id: 'ann-1',
        workspaceId: handle.seeded.workspaceId,
        deliveryId,
        stageKey: 'requirement',
        targetNodeIds: [],
        targetArtifactId: 'art-1',
        note: '保留',
        strokesJson: '[]',
        bbox: { x: 0, y: 0, w: 10, h: 10 },
        imagePath: '.baton/annotation.png',
        status: 'open',
        taskId: result.taskId,
        createdAt: 1,
        updatedAt: 1,
        resolvedAt: null,
      }),
    )

    expect(
      handle.runtime.handleCommand({
        v: 1,
        id: 'cancel-stage',
        ts: 1,
        type: 'task.cancel',
        payload: { taskId: result.taskId },
      }).ok,
    ).toBe(true)
    const detail = service.getDeliveryDetail(deliveryId)
    expect(detail?.status).toBe('cancelled')
    expect(detail?.currentStageKey).toBeNull()
    expect(detail?.cancelledAt).not.toBeNull()
    expect(listArtifactsByDelivery(handle.database.db, deliveryId)).toHaveLength(1)
    expect(listAnnotations(handle.database.db, { deliveryId })).toHaveLength(1)
  })

  it('refuses to cancel a delivered delivery', () => {
    const { handle, service } = setup()
    const result = service.createDelivery({
      workspaceId: handle.seeded.workspaceId,
      title: '已完成交付',
      goal: '验证 done 不可取消',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    const detail = service.getDeliveryDetail(result.deliveryId)
    if (!detail) throw new Error('missing delivery')
    for (const stage of detail.stages) {
      if (stage.taskId) {
        handle.database.raw
          .prepare('update task set status = ? where id = ?')
          .run('done', stage.taskId)
        continue
      }
      handle.database.db.transaction((tx) =>
        insertTask(tx, {
          id: `done-${stage.key}`,
          workspaceId: handle.seeded.workspaceId,
          nodeId: null,
          title: stage.label,
          prompt: '',
          status: 'done',
          waitingReason: null,
          engine: 'claude-sdk',
          workspaceMode: 'main',
          branch: null,
          worktreePath: null,
          verifyCommand: null,
          retryCount: 0,
          dangerouslySkipPermissions: false,
          deliveryId: result.deliveryId,
          stageKey: stage.key,
          createdAt: 1,
          updatedAt: 1,
        }),
      )
    }

    expect(service.getDeliveryDetail(result.deliveryId)?.status).toBe('done')
    expect(
      service.markDeliveryCancelled(result.deliveryId, {
        actor: 'human',
        source: 'delivery_cancel',
      }),
    ).toMatchObject({
      ok: false,
      code: 'delivery_not_cancellable',
    })
    const after = service.getDeliveryDetail(result.deliveryId)
    expect(after?.status).toBe('done')
    expect(after?.cancelledAt).toBeNull()
  })

  it('refuses to enqueue or advance a cancelled delivery', () => {
    const { handle, service } = setup()
    const result = service.createDelivery({
      workspaceId: handle.seeded.workspaceId,
      title: '取消后不可推进',
      goal: '验证 cancelledAt 守卫',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(
      service.markDeliveryCancelled(result.deliveryId, {
        actor: 'human',
        source: 'delivery_cancel',
      }).ok,
    ).toBe(true)

    expect(service.enqueueDelivery(result.deliveryId)).toMatchObject({
      ok: false,
      code: 'delivery_cancelled',
    })
    expect(service.advanceDelivery(result.deliveryId, 'requirement')).toMatchObject({
      ok: false,
      code: 'delivery_cancelled',
    })
  })
})
