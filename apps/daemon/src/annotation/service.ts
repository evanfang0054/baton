import { validateAnnotationTargets } from '@baton/core'
import type { Annotation, AnnotationSummary, AnnotationStatus } from '@baton/protocol'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import type { Config } from '../config.js'
import {
  deleteAnnotation as deleteAnnotationRow,
  getAnnotation,
  getArtifact,
  getCanvasByDelivery,
  getDelivery,
  listAnnotations as listAnnotationRows,
  listWorkspaceAnnotations,
  resolveAnnotationsForTask as resolveRepository,
  insertAnnotation,
  updateAnnotation as updateAnnotationRow,
} from '../db/delivery-repositories.js'
import { getCanvasByWorkspace, getWorkspace, insertAudit, listNodes } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import type { WsEventDraft } from '../db/event-store.js'
import { appError } from '../errors.js'
import { resolveWorkspaceDir, resolveWithin } from '../workspace/resolver.js'

export interface AnnotationServiceDeps {
  db: Db
  config: Config
  now: () => number
  newId: () => string
  emit?: (draft: WsEventDraft) => void
}

const MAX_STROKES = 2_000_000
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function safeWrite(workspacePath: string, relPath: string, data: Buffer): void {
  const target = resolveWithin(workspacePath, relPath)
  mkdirSync(dirname(target), { recursive: true })
  const realDir = realpathSync(dirname(target))
  const rel = relative(workspacePath, realDir)
  if (rel.startsWith('..') || rel.startsWith('/')) {
    throw appError('invalid_path', 'annotation path escapes workspace')
  }
  writeFileSync(target, data)
}

function summary(annotation: Annotation): AnnotationSummary {
  return {
    id: annotation.id,
    workspaceId: annotation.workspaceId,
    deliveryId: annotation.deliveryId,
    stageKey: annotation.stageKey,
    targetNodeIds: annotation.targetNodeIds,
    targetArtifactId: annotation.targetArtifactId,
    note: annotation.note,
    bbox: annotation.bbox,
    imagePath: annotation.imagePath,
    status: annotation.status,
    taskId: annotation.taskId,
    createdAt: annotation.createdAt,
  }
}

export function createAnnotationService(deps: AnnotationServiceDeps) {
  function createForScope(input: {
    workspaceId: string
    deliveryId: string | null
    stageKey: string | null
    targetNodeIds?: string[]
    targetArtifactId?: string | null
    note?: string
    strokesJson: string
    bbox: { x: number; y: number; w: number; h: number }
    imageBase64: string
  }): Annotation {
    const workspace = getWorkspace(deps.db, input.workspaceId)
    if (!workspace) throw appError('workspace_not_found', 'workspace not found')
    const workspacePath = resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
    const canvas = input.deliveryId
      ? getCanvasByDelivery(deps.db, input.deliveryId)
      : getCanvasByWorkspace(deps.db, input.workspaceId)
    if (!canvas) {
      throw appError(
        'canvas_not_found',
        input.deliveryId ? 'delivery canvas not found' : 'workspace canvas not found',
      )
    }
    const nodeIds = new Set(listNodes(deps.db, canvas.id).map((node) => node.id))
    const artifactIds = new Set(
      input.deliveryId && input.targetArtifactId
        ? [getArtifact(deps.db, input.targetArtifactId)].filter(Boolean).map((item) => item!.id)
        : [],
    )
    const targetNodeIds = input.targetNodeIds ?? []
    const issues = validateAnnotationTargets({
      targetNodeIds,
      targetArtifactId: input.targetArtifactId ?? null,
      nodeIds,
      artifactIds,
    })
    if (issues.length > 0) throw appError('invalid_payload', issues.join('; '))
    if (input.strokesJson.length > MAX_STROKES) {
      throw appError('payload_too_large', 'strokes exceed 2MB')
    }
    const image = Buffer.from(input.imageBase64, 'base64')
    if (image.length === 0 || image.length > MAX_IMAGE_BYTES) {
      throw appError('payload_too_large', 'annotation image must be between 1 byte and 10MB')
    }
    const id = deps.newId()
    const now = deps.now()
    const imagePath = input.deliveryId
      ? `.baton/deliveries/${input.deliveryId}/${input.stageKey}/annotations/${id}.png`
      : `.baton/annotations/${input.workspaceId}/${id}.png`
    safeWrite(workspacePath, imagePath, image)
    const annotation: Annotation = {
      id,
      workspaceId: input.workspaceId,
      deliveryId: input.deliveryId,
      stageKey: input.stageKey,
      targetNodeIds,
      targetArtifactId: input.deliveryId ? (input.targetArtifactId ?? null) : null,
      note: (input.note ?? '').slice(0, 2000),
      strokesJson: input.strokesJson,
      bbox: input.bbox,
      imagePath,
      status: 'open',
      taskId: null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    }
    deps.db.transaction((tx) => {
      insertAnnotation(tx, annotation)
      insertAudit(tx, {
        id: deps.newId(),
        ts: now,
        actor: 'human',
        action: 'annotation.create',
        detail: {
          annotationId: id,
          workspaceId: input.workspaceId,
          deliveryId: input.deliveryId,
          stageKey: input.stageKey,
        },
      })
    })
    deps.emit?.({
      type: 'annotation.updated',
      payload: {
        annotationId: id,
        deliveryId: input.deliveryId,
        stageKey: input.stageKey,
        status: 'open',
      },
      ts: now,
    })
    return annotation
  }

  function createAnnotation(input: {
    deliveryId: string
    stageKey: string
    targetNodeIds?: string[]
    targetArtifactId?: string | null
    note?: string
    strokesJson: string
    bbox: { x: number; y: number; w: number; h: number }
    imageBase64: string
  }): Annotation {
    const delivery = getDelivery(deps.db, input.deliveryId)
    if (!delivery) throw appError('delivery_not_found', 'delivery not found')
    return createForScope({
      ...input,
      workspaceId: delivery.workspaceId,
      deliveryId: input.deliveryId,
      stageKey: input.stageKey,
    })
  }

  function createWorkspaceAnnotation(input: {
    workspaceId: string
    targetNodeIds?: string[]
    note?: string
    strokesJson: string
    bbox: { x: number; y: number; w: number; h: number }
    imageBase64: string
  }): Annotation {
    return createForScope({
      ...input,
      deliveryId: null,
      stageKey: null,
      targetArtifactId: null,
    })
  }

  function updateAnnotation(input: {
    annotationId: string
    note?: string
    status?: AnnotationStatus
  }): AnnotationSummary {
    const annotation = getAnnotation(deps.db, input.annotationId)
    if (!annotation) throw appError('annotation_not_found', 'annotation not found')
    if (input.status && !['open', 'resolved', 'dismissed'].includes(input.status)) {
      throw appError('invalid_payload', 'invalid annotation status')
    }
    const now = deps.now()
    deps.db.transaction((tx) => {
      updateAnnotationRow(tx, annotation.id, {
        ...(input.note !== undefined ? { note: input.note.slice(0, 2000) } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.status === 'resolved' ? { resolvedAt: now } : {}),
        updatedAt: now,
      })
      insertAudit(tx, {
        id: deps.newId(),
        ts: now,
        actor: 'human',
        action: 'annotation.update',
        detail: { annotationId: annotation.id, status: input.status ?? null },
      })
    })
    const updated = getAnnotation(deps.db, annotation.id)
    const result = summary(updated ?? annotation)
    deps.emit?.({
      type: 'annotation.updated',
      payload: {
        annotationId: result.id,
        deliveryId: result.deliveryId,
        stageKey: result.stageKey,
        status: result.status,
      },
      ts: now,
    })
    return result
  }

  function listAnnotations(filter: {
    deliveryId: string
    stageKey?: string
    status?: AnnotationStatus
  }): AnnotationSummary[] {
    return listAnnotationRows(deps.db, filter).map(summary)
  }

  function listWorkspaceScopeAnnotations(filter: {
    workspaceId: string
    status?: AnnotationStatus
  }): AnnotationSummary[] {
    return listWorkspaceAnnotations(deps.db, filter).map(summary)
  }

  function removeAnnotation(annotationId: string): void {
    const annotation = getAnnotation(deps.db, annotationId)
    if (!annotation) throw appError('annotation_not_found', 'annotation not found')
    const now = deps.now()
    deps.db.transaction((tx) => {
      deleteAnnotationRow(tx, annotation.id)
      insertAudit(tx, {
        id: deps.newId(),
        ts: now,
        actor: 'human',
        action: 'annotation.delete',
        detail: {
          annotationId: annotation.id,
          deliveryId: annotation.deliveryId,
          stageKey: annotation.stageKey,
        },
      })
    })
    // 复用 updated 事件让前端失效列表；记录已不存在。
    deps.emit?.({
      type: 'annotation.updated',
      payload: {
        annotationId: annotation.id,
        deliveryId: annotation.deliveryId,
        stageKey: annotation.stageKey,
        status: annotation.status,
      },
      ts: now,
    })
  }

  function getAnnotationForSupervisor(id: string): AnnotationSummary | null {
    const annotation = getAnnotation(deps.db, id)
    return annotation ? summary(annotation) : null
  }

  function resolveAnnotationsForTask(taskId: string): string[] {
    const now = deps.now()
    const resolved = deps.db.transaction((tx) => {
      const ids = resolveRepository(tx, taskId, now)
      return ids
        .map((id) => getAnnotation(deps.db, id))
        .filter((item): item is Annotation => item !== null)
    })
    for (const annotation of resolved) {
      deps.emit?.({
        type: 'annotation.updated',
        payload: {
          annotationId: annotation.id,
          deliveryId: annotation.deliveryId,
          stageKey: annotation.stageKey,
          status: annotation.status,
        },
        ts: now,
      })
    }
    return resolved.map((annotation) => annotation.id)
  }

  return {
    createAnnotation,
    createWorkspaceAnnotation,
    updateAnnotation,
    listAnnotations,
    listWorkspaceScopeAnnotations,
    removeAnnotation,
    getAnnotationForSupervisor,
    resolveAnnotationsForTask,
  }
}

export type AnnotationService = ReturnType<typeof createAnnotationService>
