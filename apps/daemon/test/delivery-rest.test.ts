import { buildTestApp } from './helpers/app.js'
import { afterEach, describe, expect, it } from 'vitest'
import { getCanvasByDelivery } from '../src/db/delivery-repositories.js'
import { listNodes } from '../src/db/repositories.js'

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
    const { app, handle, deliveryId } = await setup()
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
  })
})
