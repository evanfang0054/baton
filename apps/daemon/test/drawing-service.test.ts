import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createArtifactService } from '../src/artifact/service.js'
import { createDrawingService } from '../src/artifact/drawing-service.js'
import { getCanvasByDelivery } from '../src/db/delivery-repositories.js'
import { listAudit, listNodes } from '../src/db/repositories.js'
import { createDeliveryService } from '../src/delivery/service.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: Array<ReturnType<typeof createTestRuntime>> = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

function setup() {
  const handle = createTestRuntime()
  handles.push(handle)
  const { db } = handle.database
  const deliveries = createDeliveryService({
    db,
    config: handle.config,
    now: handle.now,
    newId: handle.newId,
  })
  const events: Array<{ type: string; payload: Record<string, unknown> }> = []
  const artifacts = createArtifactService({
    db,
    config: handle.config,
    now: handle.now,
    newId: handle.newId,
    emit: (draft) => events.push(draft as { type: string; payload: Record<string, unknown> }),
  })
  const drawings = createDrawingService({
    db,
    config: handle.config,
    artifacts,
    now: handle.now,
    newId: handle.newId,
  })
  const created = deliveries.createDelivery({
    workspaceId: handle.seeded.workspaceId,
    title: '需求 A',
    goal: '目标 A',
  })
  if (!created.ok) throw new Error(created.message)
  const detail = deliveries.getDeliveryDetail(created.deliveryId)
  const stageKey = detail?.currentStageKey
  if (!stageKey) throw new Error('stage missing')
  return { handle, artifacts, drawings, deliveryId: created.deliveryId, stageKey, events }
}

describe('drawing service', () => {
  it('creates a drawing node, source scene, audit and stale preview event', async () => {
    const { handle, artifacts, drawings, deliveryId, stageKey, events } = setup()
    const card = await drawings.createDrawing({
      deliveryId,
      stageKey,
      operations: [
        {
          op: 'add_shape',
          shape: 'rectangle',
          id: 'box',
          x: 20,
          y: 20,
          w: 200,
          h: 100,
          text: '入口',
        },
        { op: 'add_arrow', id: 'arrow', x: 220, y: 70, w: 80, h: 0, fromId: 'box' },
      ],
    })

    expect(card).toMatchObject({
      deliveryId,
      title: '画板 1',
      elements: 3,
      texts: 1,
      previewStale: true,
    })
    const canvas = getCanvasByDelivery(handle.database.db, deliveryId)
    const node = listNodes(handle.database.db, canvas!.id).find((item) => item.type === 'drawing')
    expect(node).toMatchObject({
      id: card.nodeId,
      data: { artifactId: card.artifactId, status: 'draft', previewStale: true },
    })
    const source = artifacts.readArtifactContent(card.artifactId, 'source')
    const scene = JSON.parse(source.data.toString('utf8')) as { elements: unknown[] }
    expect(scene.elements).toHaveLength(3)
    expect(listAudit(handle.database.db, { actionPrefix: 'drawing', limit: 10 })).toHaveLength(1)
    expect(
      events.some(
        (event) =>
          event.type === 'artifact.updated' &&
          event.payload.artifactId === card.artifactId &&
          event.payload.previewStale === true,
      ),
    ).toBe(true)
  })

  it('serializes mutations so concurrent writes keep every operation', async () => {
    const { artifacts, drawings, deliveryId, stageKey } = setup()
    const card = await drawings.createDrawing({ deliveryId, stageKey })
    const [first, second] = await Promise.all([
      drawings.mutateDrawing({
        artifactId: card.artifactId,
        operations: [{ op: 'add_text', x: 20, y: 20, text: '第一条' }],
      }),
      drawings.mutateDrawing({
        artifactId: card.artifactId,
        operations: [{ op: 'add_text', x: 20, y: 60, text: '第二条' }],
      }),
    ])
    expect(first.texts).toBe(1)
    expect(second.texts).toBe(2)
    const scene = JSON.parse(
      artifacts.readArtifactContent(card.artifactId, 'source').data.toString('utf8'),
    ) as { elements: Array<{ text?: string }> }
    expect(scene.elements.flatMap((element) => (element.text ? [element.text] : []))).toEqual([
      '第一条',
      '第二条',
    ])
  })

  it('inserts a workspace image with dimensions and rejects unsafe paths', async () => {
    const { handle, drawings, deliveryId, stageKey } = setup()
    const workspace = join(handle.root, handle.seeded.relPath)
    mkdirSync(join(workspace, 'assets'), { recursive: true })
    const png = Buffer.alloc(24)
    png.writeUInt32BE(120, 16)
    png.writeUInt32BE(80, 20)
    writeFileSync(join(workspace, 'assets/shot.png'), png)
    const card = await drawings.createDrawing({
      deliveryId,
      stageKey,
      operations: [{ op: 'add_image', path: 'assets/shot.png', x: 0, y: 0 }],
    })
    expect(card).toMatchObject({ elements: 1, texts: 0 })

    writeFileSync(join(workspace, '.env'), 'SECRET=1')
    symlinkSync('../.env', join(workspace, 'assets/secret.png'))
    for (const path of [
      '../outside.png',
      '/tmp/outside.png',
      '.env',
      'assets/missing.png',
      'assets/secret.png',
    ]) {
      await expect(
        drawings.mutateDrawing({
          artifactId: card.artifactId,
          operations: [{ op: 'add_image', path, x: 0, y: 0 }],
        }),
      ).rejects.toMatchObject({ code: 'image_path_invalid' })
    }
    writeFileSync(join(workspace, 'assets/notes.txt'), 'not an image')
    await expect(
      drawings.mutateDrawing({
        artifactId: card.artifactId,
        operations: [{ op: 'add_image', path: 'assets/notes.txt', x: 0, y: 0 }],
      }),
    ).rejects.toMatchObject({ code: 'image_type_unsupported' })
  })

  it('rejects unknown drawings and invalid stages', async () => {
    const { drawings, deliveryId } = setup()
    await expect(drawings.createDrawing({ deliveryId, stageKey: 'missing' })).rejects.toMatchObject(
      { code: 'stage_not_found' },
    )
    await expect(
      drawings.mutateDrawing({
        artifactId: 'missing',
        operations: [{ op: 'add_text', x: 0, y: 0, text: 'hi' }],
      }),
    ).rejects.toMatchObject({ code: 'drawing_not_found' })
  })

  it('renames the drawing node through set_title', async () => {
    const { handle, drawings, deliveryId, stageKey } = setup()
    const card = await drawings.createDrawing({ deliveryId, stageKey, title: '旧标题' })
    const updated = await drawings.mutateDrawing({
      artifactId: card.artifactId,
      operations: [{ op: 'set_title', title: '新标题' }],
    })
    expect(updated.title).toBe('新标题')
    const canvas = getCanvasByDelivery(handle.database.db, deliveryId)
    const node = listNodes(handle.database.db, canvas!.id).find((item) => item.type === 'drawing')
    expect(node).toMatchObject({ data: { title: '新标题' } })
  })

  it('rejects oversized images and source files', async () => {
    const { handle, artifacts, drawings, deliveryId, stageKey } = setup()
    const workspace = join(handle.root, handle.seeded.relPath)
    mkdirSync(join(workspace, 'assets'), { recursive: true })
    writeFileSync(join(workspace, 'assets/huge.png'), Buffer.alloc(5 * 1024 * 1024 + 1))
    const card = await drawings.createDrawing({ deliveryId, stageKey })
    await expect(
      drawings.mutateDrawing({
        artifactId: card.artifactId,
        operations: [{ op: 'add_image', path: 'assets/huge.png', x: 0, y: 0 }],
      }),
    ).rejects.toMatchObject({ code: 'image_too_large' })

    expect(() =>
      artifacts.updateDrawingSource({
        artifactId: card.artifactId,
        sourceBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64'),
        previewStale: true,
      }),
    ).toThrowError(/source exceeds 10MB/)
  })

  it('audits drawing.update on mutations', async () => {
    const { handle, drawings, deliveryId, stageKey } = setup()
    const card = await drawings.createDrawing({ deliveryId, stageKey })
    await drawings.mutateDrawing({
      artifactId: card.artifactId,
      operations: [{ op: 'set_title', title: '改名' }],
    })
    expect(
      listAudit(handle.database.db, { actionPrefix: 'drawing.', limit: 10 }).map(
        (entry) => entry.action,
      ),
    ).toEqual(expect.arrayContaining(['drawing.create', 'drawing.update']))
  })

  it('refuses to overwrite a corrupt drawing source', async () => {
    const { artifacts, drawings, deliveryId, stageKey } = setup()
    const card = await drawings.createDrawing({ deliveryId, stageKey })
    artifacts.saveArtifactContent({
      artifactId: card.artifactId,
      sourceBase64: Buffer.from('{not-json').toString('base64'),
      mode: 'source',
    })
    await expect(
      drawings.mutateDrawing({
        artifactId: card.artifactId,
        operations: [{ op: 'add_text', x: 0, y: 0, text: '不要覆盖' }],
      }),
    ).rejects.toMatchObject({ code: 'drawing_operation_invalid' })
    expect(artifacts.readArtifactContent(card.artifactId, 'source').data.toString()).toBe(
      '{not-json',
    )
  })

  it('finds the drawing node by artifact id when the canvas has multiple drawings', async () => {
    const { artifacts, drawings, deliveryId, stageKey } = setup()
    const first = await drawings.createDrawing({ deliveryId, stageKey, title: '第一块' })
    const second = await drawings.createDrawing({ deliveryId, stageKey, title: '第二块' })
    const updated = await drawings.mutateDrawing({
      artifactId: second.artifactId,
      operations: [{ op: 'add_text', x: 0, y: 0, text: '只改第二块' }],
    })
    expect(updated).toMatchObject({ artifactId: second.artifactId, title: '第二块', texts: 1 })
    expect(artifacts.readArtifactContent(first.artifactId, 'source').data.toString()).not.toContain(
      '只改第二块',
    )
  })
})
