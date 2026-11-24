import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDrawingService } from '../src/artifact/drawing-service.js'
import { createArtifactService } from '../src/artifact/service.js'
import { getCanvasByDelivery } from '../src/db/delivery-repositories.js'
import { insertNode } from '../src/db/repositories.js'
import { createDeliveryService } from '../src/delivery/service.js'
import { appError } from '../src/errors.js'
import { createTaskService } from '../src/runtime/task-service.js'
import { createSupervisorTools, type ToolContext } from '../src/supervisor/tools.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: Array<ReturnType<typeof createTestRuntime>> = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

const scene = {
  type: 'excalidraw',
  version: 2,
  elements: [
    { id: 't-2', type: 'text', x: 10, y: 200, width: 120, height: 24, text: '按钮改成主色' },
    { id: 't-1', type: 'text', x: 10, y: 40, width: 120, height: 24, text: '领取页' },
    { id: 'box-1', type: 'rectangle', x: 0, y: 0, width: 240, height: 320 },
    { id: 'img-1', type: 'image', x: 20, y: 80, width: 160, height: 120, fileId: 'secret' },
    {
      id: 'gone',
      type: 'text',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      text: '已删除',
      isDeleted: true,
    },
  ],
  files: { secret: { dataURL: 'data:image/png;base64,c2VjcmV0' } },
}

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
  const artifacts = createArtifactService({
    db,
    config: handle.config,
    now: handle.now,
    newId: handle.newId,
  })
  const drawings = createDrawingService({
    db,
    config: handle.config,
    artifacts,
    now: handle.now,
    newId: handle.newId,
  })
  let taskSeq = 0
  const taskService = createTaskService({
    db,
    config: handle.config,
    now: handle.now,
    newId: () => `task-${++taskSeq}`,
  })
  const tools = createSupervisorTools({
    db,
    workspacesRoot: handle.root,
    taskService,
    now: handle.now,
    newId: handle.newId,
    defaultEngine: 'claude-sdk',
    enqueueTask: () => ({ ok: true, status: 'queued' }),
    applyTransition: () => ({ ok: false, error: appError('not_used', 'not used') }),
    replyToTask: () => ({ ok: true }),
    injectContext: () => ({ ok: false, error: appError('not_used', 'not used') }),
    cancelTask: () => ({ ok: false, error: appError('not_used', 'not used') }),
    deliveries: () => deliveries,
    artifacts: () => artifacts,
    drawings: () => drawings,
  })

  function createDelivery(title: string): string {
    const created = deliveries.createDelivery({
      workspaceId: handle.seeded.workspaceId,
      title,
      goal: `${title}的目标`,
    })
    if (!created.ok) throw new Error(created.message)
    return created.deliveryId
  }

  function createDrawing(deliveryId: string, nodeId: string): string {
    const artifact = artifacts.createDraftArtifact({
      deliveryId,
      stageKey: 'requirement',
      kind: 'drawing',
      name: `${nodeId}.png`,
    })
    const canvas = getCanvasByDelivery(db, deliveryId)
    if (!canvas) throw new Error('canvas missing')
    db.transaction((tx) =>
      insertNode(tx, {
        id: nodeId,
        canvasId: canvas.id,
        type: 'drawing',
        x: 0,
        y: 0,
        w: 360,
        h: 260,
        groupId: null,
        data: { artifactId: artifact.id, title: nodeId, thumbnailPath: null, status: 'draft' },
        createdAt: 1,
        updatedAt: 1,
      }),
    )
    artifacts.saveArtifactContent({
      artifactId: artifact.id,
      previewBase64: Buffer.from('png').toString('base64'),
      sourceBase64: Buffer.from(JSON.stringify(scene)).toString('base64'),
      mode: 'full',
    })
    return artifact.id
  }

  return { handle, deliveries, artifacts, drawings, tools, createDelivery, createDrawing }
}

function ctxFor(
  workspaceId: string,
  deliveryId: string | null,
  stageKey: string | null = 'requirement',
): ToolContext {
  return {
    workspaceId,
    deliveryId,
    stageKey,
    allowWorkspaceCanvas: false,
    threadId: 'th1',
    triggerId: 'r1',
    text: '看看画板',
    actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
    selection: { contextNodeIds: [], targetNodeId: undefined, agentCandidates: [] },
    policyVersion: 'p1',
    promptVersion: 'v1',
    memo: {},
  }
}

describe('supervisor scoped canvas and drawing tools', () => {
  it('reads the whole drawing by node and never leaks base64 files', async () => {
    const { handle, tools, createDelivery, createDrawing } = setup()
    const deliveryId = createDelivery('需求 A')
    const artifactId = createDrawing(deliveryId, 'drawing-1')

    const result = (await tools.get_drawing.execute(
      { nodeId: 'drawing-1' },
      ctxFor(handle.seeded.workspaceId, deliveryId),
    )) as {
      artifactId: string
      texts: Array<{ text: string }>
      elements: Array<{ id: string }>
      counts: Record<string, number>
      totalElements: number
      totalTexts: number
      truncated: boolean
      bounds: { minX: number; maxY: number }
    }

    expect(result.artifactId).toBe(artifactId)
    expect(result.texts.map((text) => text.text)).toEqual(['领取页', '按钮改成主色'])
    expect(result.elements.map((element) => element.id)).not.toContain('gone')
    expect(result.elements).toHaveLength(4)
    expect(result.counts).toEqual({ text: 2, rectangle: 1, image: 1 })
    expect(result.totalElements).toBe(4)
    expect(result.totalTexts).toBe(2)
    expect(result.bounds).toMatchObject({ minX: 0, maxY: 320 })
    expect(result.truncated).toBe(false)
    expect(JSON.stringify(result)).not.toContain('c2VjcmV0')
  })

  it('pages texts and reports nextOffset', async () => {
    const { handle, tools, createDelivery, createDrawing } = setup()
    const deliveryId = createDelivery('需求 A')
    createDrawing(deliveryId, 'drawing-1')

    const first = (await tools.get_drawing.execute(
      { nodeId: 'drawing-1', limit: 1 },
      ctxFor(handle.seeded.workspaceId, deliveryId),
    )) as {
      texts: Array<{ text: string; index: number }>
      truncated: boolean
      nextOffset?: number
    }
    expect(first.texts).toEqual([expect.objectContaining({ text: '领取页', index: 0 })])
    expect(first.nextOffset).toBe(1)
    expect(first.truncated).toBe(true)

    const second = (await tools.get_drawing.execute(
      { nodeId: 'drawing-1', offset: 1, limit: 1 },
      ctxFor(handle.seeded.workspaceId, deliveryId),
    )) as {
      texts: Array<{ text: string; index: number }>
      truncated: boolean
      nextOffset?: number
    }
    expect(second.texts).toEqual([expect.objectContaining({ text: '按钮改成主色', index: 1 })])
    expect(second.nextOffset).toBeUndefined()
    expect(second.truncated).toBe(false)
  })

  it('lists another delivery canvas on demand and summarizes drawings', async () => {
    const { handle, tools, createDelivery, createDrawing } = setup()
    const first = createDelivery('需求 A')
    const second = createDelivery('需求 B')
    createDrawing(second, 'drawing-2')

    const scoped = (await tools.list_canvas.execute(
      { scope: 'delivery', deliveryId: second },
      ctxFor(handle.seeded.workspaceId, first),
    )) as {
      scope: string
      deliveryId: string
      nodes: Array<Record<string, unknown>>
    }
    expect(scoped.scope).toBe('delivery')
    expect(scoped.deliveryId).toBe(second)
    expect(scoped.nodes.find((node) => node.type === 'drawing')).toEqual(
      expect.objectContaining({
        type: 'drawing',
        title: 'drawing-2',
        summary: '领取页 / 按钮改成主色',
        textCount: 2,
        imageCount: 1,
      }),
    )

    const current = (await tools.list_canvas.execute(
      {},
      ctxFor(handle.seeded.workspaceId, first),
    )) as { scope: string; nodes: Array<Record<string, unknown>> }
    expect(current.scope).toBe('current')
    expect(current.nodes.some((node) => node.type === 'drawing')).toBe(false)
  })

  it('rejects delivery scope without deliveryId and drawings from other workspaces', async () => {
    const { handle, tools, createDelivery, createDrawing } = setup()
    const deliveryId = createDelivery('需求 A')
    const artifactId = createDrawing(deliveryId, 'drawing-1')

    await expect(
      tools.list_canvas.execute(
        { scope: 'delivery' },
        ctxFor(handle.seeded.workspaceId, deliveryId),
      ),
    ).rejects.toMatchObject({ code: 'invalid_payload' })

    await expect(
      tools.get_drawing.execute({ artifactId }, ctxFor('another-workspace', null)),
    ).rejects.toMatchObject({ code: 'drawing_not_found' })

    await expect(
      tools.get_drawing.execute({ nodeId: 'text-1' }, ctxFor(handle.seeded.workspaceId, null)),
    ).rejects.toMatchObject({ code: 'drawing_not_found' })
  })

  it('returns an empty drawing when the source file is missing', async () => {
    const { handle, artifacts, tools, createDelivery } = setup()
    const deliveryId = createDelivery('需求 A')
    const artifact = artifacts.createDraftArtifact({
      deliveryId,
      stageKey: 'requirement',
      kind: 'drawing',
      name: 'empty.png',
    })

    const result = (await tools.get_drawing.execute(
      { artifactId: artifact.id },
      ctxFor(handle.seeded.workspaceId, deliveryId),
    )) as { empty?: boolean; texts: unknown[]; totalElements: number }
    expect(result).toMatchObject({ empty: true, texts: [], totalElements: 0 })
  })

  it('creates and updates a drawing on the current requirement only', async () => {
    const { handle, tools, createDelivery } = setup()
    const first = createDelivery('需求 A')
    const second = createDelivery('需求 B')
    const workspace = join(handle.root, handle.seeded.relPath)
    mkdirSync(join(workspace, 'assets'), { recursive: true })
    writeFileSync(join(workspace, 'assets/logo.png'), Buffer.alloc(24))

    const created = (await tools.create_drawing.execute(
      {
        title: '流程草图',
        operations: [
          {
            op: 'add_shape',
            shape: 'rectangle',
            id: 'box',
            x: 20,
            y: 20,
            w: 200,
            h: 80,
            text: '入口',
          },
          { op: 'add_image', path: 'assets/logo.png', x: 20, y: 140 },
        ],
      },
      ctxFor(handle.seeded.workspaceId, first),
    )) as {
      artifactId: string
      nodeId: string
      deliveryId: string
      title: string
      elements: number
      texts: number
    }
    expect(created).toMatchObject({
      deliveryId: first,
      title: '流程草图',
      elements: 3,
      texts: 1,
    })

    const updated = (await tools.update_drawing.execute(
      { nodeId: created.nodeId, operations: [{ op: 'add_text', x: 0, y: 240, text: '补充说明' }] },
      ctxFor(handle.seeded.workspaceId, first),
    )) as { elements: number; texts: number }
    expect(updated).toMatchObject({ elements: 4, texts: 2 })

    const read = (await tools.get_drawing.execute(
      { nodeId: created.nodeId },
      ctxFor(handle.seeded.workspaceId, first),
    )) as { texts: Array<{ text: string }> }
    expect(read.texts.map((item) => item.text)).toEqual(['入口', '补充说明'])

    await expect(
      tools.update_drawing.execute(
        { nodeId: created.nodeId, operations: [{ op: 'add_text', x: 0, y: 0, text: '越界' }] },
        ctxFor(handle.seeded.workspaceId, second),
      ),
    ).rejects.toMatchObject({ code: 'drawing_not_found' })

    await expect(
      tools.create_drawing.execute(
        { operations: [{ op: 'add_image', path: '.env', x: 0, y: 0 }] },
        ctxFor(handle.seeded.workspaceId, first),
      ),
    ).rejects.toMatchObject({ code: 'image_path_invalid' })
  })

  it('refuses drawing writes without a requirement', async () => {
    const { handle, tools } = setup()
    await expect(
      tools.create_drawing.execute(
        { operations: [{ op: 'add_text', x: 0, y: 0, text: 'hi' }] },
        ctxFor(handle.seeded.workspaceId, null),
      ),
    ).rejects.toMatchObject({ code: 'canvas_not_found' })
  })
})
