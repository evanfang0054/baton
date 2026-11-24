import { buildTestApp } from './helpers/app.js'
import { afterEach, describe, expect, it } from 'vitest'
import { getCanvasByDelivery } from '../src/db/delivery-repositories.js'
import { insertTask, listAudit, listNodes } from '../src/db/repositories.js'

const apps: Array<Awaited<ReturnType<typeof buildTestApp>>> = []
afterEach(async () => {
  await Promise.all(
    apps.splice(0).map(async ({ app, handle }) => {
      await app.close()
      await handle.cleanup()
    }),
  )
})

async function setup() {
  const built = await buildTestApp()
  apps.push(built)
  const created = await built.app.inject({
    method: 'POST',
    url: '/api/deliveries',
    payload: {
      workspaceId: built.handle.seeded.workspaceId,
      title: '优惠券领取页',
      goal: '做一个领取页',
    },
  })
  expect(created.statusCode).toBe(200)
  const body = created.json() as { delivery: { id: string }; taskId: string }
  return { ...built, deliveryId: body.delivery.id, taskId: body.taskId }
}

describe('delivery REST', () => {
  it('creates, lists, enqueues and cancels a delivery', async () => {
    const { app, handle, deliveryId, taskId } = await setup()
    const list = await app.inject({
      method: 'GET',
      url: `/api/deliveries?workspaceId=${handle.seeded.workspaceId}`,
    })
    expect(list.statusCode).toBe(200)
    expect((list.json() as { deliveries: unknown[] }).deliveries).toHaveLength(1)

    const detail = await app.inject({ method: 'GET', url: `/api/deliveries/${deliveryId}` })
    expect(detail.statusCode).toBe(200)
    expect((detail.json() as { delivery: { stages: unknown[] } }).delivery.stages).toHaveLength(4)

    const canvas = await app.inject({
      method: 'GET',
      url: `/api/canvas?workspaceId=${handle.seeded.workspaceId}&deliveryId=${deliveryId}`,
    })
    expect(canvas.statusCode, canvas.body).toBe(200)
    const canvasBody = canvas.json() as {
      canvas: { id: string }
      nodes: Array<{ type: string; data?: { stageKey?: string } }>
    }
    expect(canvasBody.canvas.id).toBe(getCanvasByDelivery(handle.database.db, deliveryId)?.id)
    expect(canvasBody.nodes.filter((node) => node.data?.stageKey)).toHaveLength(4)
    expect(listNodes(handle.database.db, canvasBody.canvas.id).length).toBeGreaterThan(0)

    const enqueue = await app.inject({
      method: 'POST',
      url: `/api/deliveries/${deliveryId}/enqueue`,
    })
    expect(enqueue.statusCode).toBe(200)

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/deliveries/${deliveryId}/cancel`,
      payload: { reason: '需求取消' },
    })
    expect(cancel.statusCode).toBe(200)
    const after = await app.inject({ method: 'GET', url: `/api/deliveries/${deliveryId}` })
    const afterBody = after.json() as {
      delivery: { status: string; cancelledAt: number | null; currentStageKey: string | null }
    }
    expect(afterBody.delivery).toMatchObject({
      status: 'cancelled',
      currentStageKey: null,
    })
    expect(afterBody.delivery.cancelledAt).not.toBeNull()
    const taskRow = handle.database.raw
      .prepare('select status from task where id = ?')
      .get(taskId) as { status: string }
    expect(taskRow.status).toBe('cancelled')
    const audit = listAudit(handle.database.db, { actionPrefix: 'delivery.cancel', limit: 10 })[0]
    expect(audit).toMatchObject({
      actor: 'human',
      detail: { deliveryId, source: 'delivery_cancel' },
    })
  })

  it('returns 409 when cancelling a delivered delivery', async () => {
    const { app, handle, deliveryId } = await setup()
    const detail = await app.inject({ method: 'GET', url: `/api/deliveries/${deliveryId}` })
    const stages = (
      detail.json() as { delivery: { stages: Array<{ key: string; taskId: string | null }> } }
    ).delivery.stages
    for (const stage of stages) {
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
          title: stage.key,
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
          deliveryId,
          stageKey: stage.key,
          createdAt: 1,
          updatedAt: 1,
        }),
      )
    }

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/deliveries/${deliveryId}/cancel`,
    })
    expect(cancel.statusCode).toBe(409)
    expect((cancel.json() as { code: string }).code).toBe('delivery_not_cancellable')
  })

  it('creates, saves and reads artifacts', async () => {
    const { app, deliveryId } = await setup()
    const draft = await app.inject({
      method: 'POST',
      url: `/api/deliveries/${deliveryId}/stages/design/artifacts`,
      payload: { stageKey: 'design', kind: 'drawing', name: 'wireframe.png' },
    })
    expect(draft.statusCode).toBe(200)
    const artifactId = (draft.json() as { artifact: { id: string } }).artifact.id

    const saved = await app.inject({
      method: 'PUT',
      url: `/api/deliveries/${deliveryId}/artifacts/${artifactId}`,
      payload: { previewBase64: Buffer.from('hello').toString('base64') },
    })
    expect(saved.statusCode).toBe(200)

    const content = await app.inject({
      method: 'GET',
      url: `/api/deliveries/${deliveryId}/artifacts/${artifactId}/content`,
    })
    expect(content.statusCode).toBe(200)
    expect(content.rawPayload.toString()).toBe('hello')
  })

  it('creates and lists annotations', async () => {
    const { app, handle, deliveryId } = await setup()
    const canvas = getCanvasByDelivery(handle.database.db, deliveryId)
    if (!canvas) throw new Error('missing canvas')
    const node = listNodes(handle.database.db, canvas.id)[0]
    if (!node) throw new Error('missing node')

    const created = await app.inject({
      method: 'POST',
      url: `/api/deliveries/${deliveryId}/annotations`,
      payload: {
        stageKey: 'design',
        targetNodeIds: [node.id],
        note: '按钮右对齐',
        strokesJson: '[]',
        bbox: { x: 0, y: 0, w: 10, h: 10 },
        imageBase64: Buffer.from('png').toString('base64'),
      },
    })
    expect(created.statusCode).toBe(200)

    const list = await app.inject({
      method: 'GET',
      url: `/api/deliveries/${deliveryId}/annotations?status=open`,
    })
    expect(list.statusCode).toBe(200)
    expect((list.json() as { annotations: unknown[] }).annotations).toHaveLength(1)

    const annotationId = (created.json() as { annotation: { id: string } }).annotation.id
    const drawing = await app.inject({
      method: 'GET',
      url: `/api/annotations/${annotationId}`,
    })
    expect(drawing.statusCode).toBe(200)
    expect((drawing.json() as { annotation: { strokesJson: string } }).annotation.strokesJson).toBe(
      '[]',
    )
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/annotations/${annotationId}`,
    })
    expect(removed.statusCode).toBe(200)
    const after = await app.inject({
      method: 'GET',
      url: `/api/deliveries/${deliveryId}/annotations`,
    })
    expect((after.json() as { annotations: unknown[] }).annotations).toHaveLength(0)
  })

  it('creates, lists and deletes workspace-scoped annotations', async () => {
    const { app, handle, deliveryId } = await setup()

    const created = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${handle.seeded.workspaceId}/annotations`,
      payload: {
        targetNodeIds: ['text-1'],
        note: '工作区备注',
        strokesJson: '[]',
        bbox: { x: 0, y: 0, w: 10, h: 10 },
        imageBase64: Buffer.from('png').toString('base64'),
      },
    })
    expect(created.statusCode, created.body).toBe(200)
    const annotation = (created.json() as { annotation: { id: string; deliveryId: string | null } })
      .annotation
    expect(annotation.deliveryId).toBeNull()

    const list = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${handle.seeded.workspaceId}/annotations?status=open`,
    })
    expect(list.statusCode).toBe(200)
    expect((list.json() as { annotations: unknown[] }).annotations).toHaveLength(1)

    const deliveryList = await app.inject({
      method: 'GET',
      url: `/api/deliveries/${deliveryId}/annotations`,
    })
    expect((deliveryList.json() as { annotations: unknown[] }).annotations).toHaveLength(0)

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/annotations/${annotation.id}`,
    })
    expect(removed.statusCode).toBe(200)

    const after = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${handle.seeded.workspaceId}/annotations`,
    })
    expect((after.json() as { annotations: unknown[] }).annotations).toHaveLength(0)
  })
})
