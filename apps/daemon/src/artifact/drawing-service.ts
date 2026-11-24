import {
  applyDrawingOperations,
  createEmptyScene,
  DrawingOperationError,
  extractDrawingContent,
  isSensitivePath,
  type ResolvedDrawingOperation,
} from '@baton/core'
import type { Artifact, DrawingOperation, SupervisorDrawingCard } from '@baton/protocol'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { Config } from '../config.js'
import { getArtifact, getCanvasByDelivery, getDelivery } from '../db/delivery-repositories.js'
import type { Db } from '../db/types.js'
import { insertAudit, insertNode, listNodes } from '../db/repositories.js'
import { appError } from '../errors.js'
import { resolveWithin } from '../workspace/resolver.js'
import type { ArtifactService } from './service.js'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const DEFAULT_IMAGE_WIDTH = 320
const DEFAULT_IMAGE_HEIGHT = 240
const DRAWING_WIDTH = 360
const DRAWING_HEIGHT = 260

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

export interface DrawingServiceDeps {
  db: Db
  config: Config
  artifacts: ArtifactService
  now: () => number
  newId: () => string
}

function imageSize(buffer: Buffer, mime: string): { width: number; height: number } {
  if (mime === 'image/png' && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (mime === 'image/gif' && buffer.length >= 10) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }
  if (mime === 'image/jpeg') {
    let offset = 2
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = buffer[offset + 1]!
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
        }
      }
      const length = buffer.readUInt16BE(offset + 2)
      if (length < 2) break
      offset += 2 + length
    }
  }
  return { width: DEFAULT_IMAGE_WIDTH, height: DEFAULT_IMAGE_HEIGHT }
}

export function createDrawingService(deps: DrawingServiceDeps) {
  const queues = new Map<string, Promise<unknown>>()

  async function withArtifactLock<T>(artifactId: string, action: () => T | Promise<T>) {
    const previous = queues.get(artifactId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(action)
    queues.set(artifactId, run)
    try {
      return await run
    } finally {
      if (queues.get(artifactId) === run) queues.delete(artifactId)
    }
  }

  function validateStage(deliveryId: string, stageKey: string): void {
    const delivery = getDelivery(deps.db, deliveryId)
    if (!delivery) {
      throw appError('delivery_not_found', 'delivery not found', { deliveryId })
    }
    let stages: string[]
    try {
      const parsed = JSON.parse(delivery.playbookJson) as {
        stages?: Array<{ key?: unknown }>
      }
      stages = Array.isArray(parsed.stages)
        ? parsed.stages.flatMap((stage) => (typeof stage.key === 'string' ? [stage.key] : []))
        : []
    } catch {
      stages = []
    }
    if (!stages.includes(stageKey)) {
      throw appError('stage_not_found', 'stage not found', { deliveryId, stageKey })
    }
  }

  function resolveImages(
    deliveryId: string,
    operations: DrawingOperation[],
  ): ResolvedDrawingOperation[] {
    if (!operations.some((operation) => operation.op === 'add_image')) return operations
    const workspacePath = deps.artifacts.workspacePathOf(deliveryId)
    if (!workspacePath) throw appError('workspace_not_found', 'workspace not found')
    return operations.map((operation) => {
      if (operation.op !== 'add_image') return operation
      const path = operation.path
      if (isAbsolute(path) || isSensitivePath(path)) {
        throw appError('image_path_invalid', 'image path is not allowed', { path })
      }
      let target: string
      try {
        target = resolveWithin(workspacePath, path)
      } catch {
        throw appError('image_path_invalid', 'image path is outside the workspace', { path })
      }
      if (!existsSync(target) || !statSync(target).isFile()) {
        throw appError('image_path_invalid', 'image file not found', { path })
      }
      const size = statSync(target).size
      if (size > MAX_IMAGE_BYTES) {
        throw appError('image_too_large', 'image exceeds 5MB', { path, size })
      }
      const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
      const mime = IMAGE_MIME[extension]
      if (!mime) {
        throw appError('image_type_unsupported', 'image type is not supported', { path })
      }
      const buffer = readFileSync(target)
      const dimensions = imageSize(buffer, mime)
      return {
        ...operation,
        image: {
          dataURL: `data:${mime};base64,${buffer.toString('base64')}`,
          mimeType: mime,
          ...dimensions,
        },
      } as ResolvedDrawingOperation
    })
  }

  function applyScene(scene: unknown, operations: DrawingOperation[], deliveryId: string) {
    try {
      return applyDrawingOperations(scene, resolveImages(deliveryId, operations), {
        newId: deps.newId,
        now: deps.now(),
      })
    } catch (error) {
      if (error instanceof DrawingOperationError) {
        throw appError(error.code, error.message)
      }
      throw error
    }
  }

  function drawingNode(
    artifactId: string,
    deliveryId: string,
  ): { id: string; title: string } | null {
    const canvas = getCanvasByDelivery(deps.db, deliveryId)
    if (!canvas) return null
    const node = listNodes(deps.db, canvas.id).find((item) => item.type === 'drawing')
    if (!node || node.type !== 'drawing' || node.data.artifactId !== artifactId) return null
    return { id: node.id, title: node.data.title }
  }

  function card(artifact: Artifact, scene: unknown): SupervisorDrawingCard {
    const node = drawingNode(artifact.id, artifact.deliveryId)
    if (!node) {
      throw appError('drawing_not_found', 'drawing node not found', { artifactId: artifact.id })
    }
    const content = extractDrawingContent(scene)
    return {
      artifactId: artifact.id,
      deliveryId: artifact.deliveryId,
      nodeId: node.id,
      title: node.title,
      elements: content.totalElements,
      texts: content.totalTexts,
      previewStale: true,
    }
  }

  function defaultTitle(deliveryId: string): string {
    const canvas = getCanvasByDelivery(deps.db, deliveryId)
    const count = canvas
      ? listNodes(deps.db, canvas.id).filter((node) => node.type === 'drawing').length
      : 0
    return `画板 ${count + 1}`
  }

  function nextPosition(deliveryId: string, stageKey: string): { x: number; y: number } {
    const canvas = getCanvasByDelivery(deps.db, deliveryId)
    if (!canvas) return { x: 80, y: 80 }
    const nodes = listNodes(deps.db, canvas.id)
    const stageGroup = nodes.find(
      (node) => node.type === 'group' && node.data.stageKey === stageKey,
    )
    if (stageGroup) {
      return { x: stageGroup.x + 40, y: stageGroup.y + stageGroup.h + 40 }
    }
    const maxX = nodes.reduce((value, node) => Math.max(value, node.x + node.w), 0)
    return { x: nodes.length > 0 ? maxX + 80 : 80, y: 80 }
  }

  function createDrawing(input: {
    deliveryId: string
    stageKey: string
    title?: string
    operations?: DrawingOperation[]
  }): Promise<SupervisorDrawingCard> {
    return withArtifactLock(`create:${input.deliveryId}`, () => {
      validateStage(input.deliveryId, input.stageKey)
      const title = (input.title ?? defaultTitle(input.deliveryId)).slice(0, 80)
      const artifact = deps.artifacts.createDraftArtifact({
        deliveryId: input.deliveryId,
        stageKey: input.stageKey,
        kind: 'drawing',
        name: `drawing-${deps.newId().slice(0, 8)}.png`,
      })
      const scene = input.operations?.length
        ? applyScene(createEmptyScene(), input.operations, input.deliveryId)
        : createEmptyScene()
      deps.artifacts.saveArtifactContent({
        artifactId: artifact.id,
        sourceBase64: Buffer.from(JSON.stringify(scene)).toString('base64'),
        mode: 'source',
      })
      const canvas = getCanvasByDelivery(deps.db, artifact.deliveryId)
      if (!canvas) {
        throw appError('canvas_not_found', 'delivery canvas not found', {
          deliveryId: artifact.deliveryId,
        })
      }
      const nodeId = deps.newId()
      const position = nextPosition(input.deliveryId, input.stageKey)
      deps.db.transaction((tx) =>
        insertNode(tx, {
          id: nodeId,
          canvasId: canvas.id,
          type: 'drawing',
          x: position.x,
          y: position.y,
          w: DRAWING_WIDTH,
          h: DRAWING_HEIGHT,
          groupId: null,
          data: {
            artifactId: artifact.id,
            title,
            thumbnailPath: null,
            status: 'draft',
            previewStale: true,
          },
          createdAt: deps.now(),
          updatedAt: deps.now(),
        }),
      )
      const updated = deps.artifacts.updateDrawingSource({
        artifactId: artifact.id,
        sourceBase64: Buffer.from(JSON.stringify(scene)).toString('base64'),
        previewStale: true,
      })
      deps.db.transaction((tx) =>
        insertAudit(tx, {
          id: deps.newId(),
          ts: deps.now(),
          actor: 'supervisor',
          action: 'supervisor.drawing.create',
          detail: {
            artifactId: artifact.id,
            deliveryId: input.deliveryId,
            stageKey: input.stageKey,
            nodeId,
            operations: input.operations?.length ?? 0,
          },
        }),
      )
      return card(updated, scene)
    })
  }

  function mutateDrawing(input: {
    artifactId: string
    operations: DrawingOperation[]
  }): Promise<SupervisorDrawingCard> {
    return withArtifactLock(input.artifactId, () => {
      const artifact = getArtifact(deps.db, input.artifactId)
      if (!artifact || artifact.kind !== 'drawing') {
        throw appError('drawing_not_found', 'drawing artifact not found', {
          artifactId: input.artifactId,
        })
      }
      let scene: unknown = createEmptyScene()
      try {
        const { data } = deps.artifacts.readArtifactContent(artifact.id, 'source')
        scene = JSON.parse(data.toString('utf8')) as unknown
      } catch {
        // 新画板还没有 source 时允许从空场景开始写入。
      }
      const next = applyScene(scene, input.operations, artifact.deliveryId)
      const updated = deps.artifacts.updateDrawingSource({
        artifactId: artifact.id,
        sourceBase64: Buffer.from(JSON.stringify(next)).toString('base64'),
        previewStale: true,
      })
      const result = card(updated, next)
      deps.db.transaction((tx) =>
        insertAudit(tx, {
          id: deps.newId(),
          ts: deps.now(),
          actor: 'supervisor',
          action: 'supervisor.drawing.update',
          detail: {
            artifactId: artifact.id,
            deliveryId: artifact.deliveryId,
            nodeId: result.nodeId,
            operations: input.operations.length,
          },
        }),
      )
      return result
    })
  }

  return {
    createDrawing,
    mutateDrawing,
    drawingNode,
  }
}

export type DrawingService = ReturnType<typeof createDrawingService>
