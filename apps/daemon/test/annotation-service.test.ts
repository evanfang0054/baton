import { afterEach, describe, expect, it } from 'vitest'
import { createAnnotationService } from '../src/annotation/service.js'
import { createArtifactService } from '../src/artifact/service.js'
import { getCanvasByDelivery } from '../src/db/delivery-repositories.js'
import { listNodes } from '../src/db/repositories.js'
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
  const annotations = createAnnotationService({
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
  const canvas = getCanvasByDelivery(handle.database.db, created.deliveryId)
  const node = canvas ? listNodes(handle.database.db, canvas.id)[0] : null
  if (!node) throw new Error('missing delivery node')
  const artifact = artifacts.createDraftArtifact({
    deliveryId: created.deliveryId,
    stageKey: 'design',
    kind: 'design',
    name: 'design.png',
  })
  return {
    handle,
    annotations,
    deliveryId: created.deliveryId,
    nodeId: node.id,
    artifactId: artifact.id,
  }
}

describe('annotation service', () => {
  it('creates, lists, updates and hides strokes from supervisor', () => {
    const { annotations, deliveryId, nodeId, artifactId } = setup()
    const created = annotations.createAnnotation({
      deliveryId,
      stageKey: 'design',
      targetNodeIds: [nodeId],
      targetArtifactId: artifactId,
      note: '按钮右对齐',
      strokesJson: '[]',
      bbox: { x: 0, y: 0, w: 10, h: 10 },
      imageBase64: Buffer.from('png').toString('base64'),
    })
    expect(created.status).toBe('open')

    expect(annotations.listAnnotations({ deliveryId, status: 'open' })).toHaveLength(1)
    expect(annotations.getAnnotationForSupervisor(created.id)).toMatchObject({
      note: '按钮右对齐',
    })
    expect(annotations.getAnnotationForSupervisor(created.id)).not.toHaveProperty('strokesJson')

    expect(
      annotations.updateAnnotation({ annotationId: created.id, status: 'resolved' }),
    ).toMatchObject({
      id: created.id,
      status: 'resolved',
    })
    expect(annotations.listAnnotations({ deliveryId, status: 'open' })).toHaveLength(0)
  })

  it('rejects a target node outside the delivery canvas', () => {
    const { annotations, deliveryId } = setup()
    expect(() =>
      annotations.createAnnotation({
        deliveryId,
        stageKey: 'design',
        targetNodeIds: ['missing'],
        note: 'x',
        strokesJson: '[]',
        bbox: { x: 0, y: 0, w: 10, h: 10 },
        imageBase64: Buffer.from('png').toString('base64'),
      }),
    ).toThrow()
  })
})
