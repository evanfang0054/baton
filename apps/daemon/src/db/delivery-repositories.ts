import type {
  Annotation,
  AnnotationStatus,
  Artifact,
  ArtifactStatus,
  Canvas,
  Delivery,
  Playbook,
} from '@baton/protocol'
import { and, desc, eq } from 'drizzle-orm'
import { annotation, artifact, canvas, delivery } from './schema.js'
import type { Db, Tx } from './types.js'

function toDelivery(row: typeof delivery.$inferSelect): Delivery {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    canvasId: row.canvasId,
    title: row.title,
    goal: row.goal,
    playbookId: row.playbookId,
    playbookVersion: row.playbookVersion,
    playbookJson: row.playbookJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cancelledAt: row.cancelledAt ?? null,
  }
}

function toArtifact(row: typeof artifact.$inferSelect): Artifact {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    deliveryId: row.deliveryId,
    stageKey: row.stageKey,
    taskId: row.taskId ?? null,
    kind: row.kind as Artifact['kind'],
    name: row.name,
    path: row.path,
    sourcePath: row.sourcePath ?? null,
    svgPath: row.svgPath ?? null,
    mime: row.mime ?? null,
    size: row.size,
    sha256: row.sha256,
    version: row.version,
    status: row.status as ArtifactStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function toAnnotation(row: typeof annotation.$inferSelect): Annotation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    deliveryId: row.deliveryId,
    stageKey: row.stageKey,
    targetNodeIds: parseJson<string[]>(row.targetNodeIdsJson, []),
    targetArtifactId: row.targetArtifactId ?? null,
    note: row.note,
    strokesJson: row.strokesJson,
    bbox: parseJson(row.bboxJson, { x: 0, y: 0, w: 0, h: 0 }),
    imagePath: row.imagePath,
    status: row.status as AnnotationStatus,
    taskId: row.taskId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt ?? null,
  }
}

export function insertDelivery(tx: Tx, input: Delivery): void {
  tx.insert(delivery)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      canvasId: input.canvasId,
      title: input.title,
      goal: input.goal,
      playbookId: input.playbookId,
      playbookVersion: input.playbookVersion,
      playbookJson: input.playbookJson,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      cancelledAt: input.cancelledAt,
    })
    .run()
}

export function getDelivery(db: Db, id: string): Delivery | null {
  const row = db.select().from(delivery).where(eq(delivery.id, id)).get()
  return row ? toDelivery(row) : null
}

export function getDeliveryByCanvas(db: Db, canvasId: string): Delivery | null {
  const row = db.select().from(delivery).where(eq(delivery.canvasId, canvasId)).get()
  return row ? toDelivery(row) : null
}

export function listDeliveries(db: Db, workspaceId: string): Delivery[] {
  return db
    .select()
    .from(delivery)
    .where(eq(delivery.workspaceId, workspaceId))
    .orderBy(desc(delivery.createdAt))
    .all()
    .map(toDelivery)
}

export function updateDelivery(
  tx: Tx,
  id: string,
  patch: { title?: string; goal?: string; cancelledAt?: number | null; updatedAt: number },
): void {
  tx.update(delivery)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.goal !== undefined ? { goal: patch.goal } : {}),
      ...(patch.cancelledAt !== undefined ? { cancelledAt: patch.cancelledAt } : {}),
      updatedAt: patch.updatedAt,
    })
    .where(eq(delivery.id, id))
    .run()
}

export function setDeliveryCancelled(tx: Tx, id: string, at: number): void {
  tx.update(delivery).set({ cancelledAt: at, updatedAt: at }).where(eq(delivery.id, id)).run()
}

export function getCanvasByDelivery(db: Db, deliveryId: string): Canvas | null {
  const row = db.select().from(canvas).where(eq(canvas.deliveryId, deliveryId)).get()
  if (!row) return null
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    viewport: (() => {
      const parsed = parseJson<Partial<Canvas['viewport']>>(row.viewportJson, {})
      return { x: parsed.x ?? 0, y: parsed.y ?? 0, zoom: parsed.zoom ?? 1 }
    })(),
  }
}

export function setCanvasDelivery(tx: Tx, canvasId: string, deliveryId: string): void {
  tx.update(canvas).set({ deliveryId }).where(eq(canvas.id, canvasId)).run()
}

export function insertArtifact(tx: Tx, input: Artifact): void {
  tx.insert(artifact)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      deliveryId: input.deliveryId,
      stageKey: input.stageKey,
      taskId: input.taskId,
      kind: input.kind,
      name: input.name,
      path: input.path,
      sourcePath: input.sourcePath,
      svgPath: input.svgPath,
      mime: input.mime,
      size: input.size,
      sha256: input.sha256,
      version: input.version,
      status: input.status,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .run()
}

export function upsertArtifact(tx: Tx, input: Artifact): void {
  const existing = tx
    .select()
    .from(artifact)
    .where(
      and(
        eq(artifact.deliveryId, input.deliveryId),
        eq(artifact.stageKey, input.stageKey),
        eq(artifact.name, input.name),
      ),
    )
    .get()
  if (!existing) {
    insertArtifact(tx, input)
    return
  }
  tx.update(artifact)
    .set({
      taskId: input.taskId,
      kind: input.kind,
      path: input.path,
      sourcePath: input.sourcePath,
      svgPath: input.svgPath,
      mime: input.mime,
      size: input.size,
      sha256: input.sha256,
      version: existing.version + 1,
      status: input.status,
      updatedAt: input.updatedAt,
    })
    .where(eq(artifact.id, existing.id))
    .run()
}

export function getArtifact(db: Db, id: string): Artifact | null {
  const row = db.select().from(artifact).where(eq(artifact.id, id)).get()
  return row ? toArtifact(row) : null
}

export function listArtifactsByDelivery(db: Db, deliveryId: string): Artifact[] {
  return db
    .select()
    .from(artifact)
    .where(eq(artifact.deliveryId, deliveryId))
    .orderBy(desc(artifact.createdAt))
    .all()
    .map(toArtifact)
}

export function listArtifactsByStage(db: Db, deliveryId: string, stageKey: string): Artifact[] {
  return db
    .select()
    .from(artifact)
    .where(and(eq(artifact.deliveryId, deliveryId), eq(artifact.stageKey, stageKey)))
    .orderBy(desc(artifact.createdAt))
    .all()
    .map(toArtifact)
}

export function updateArtifactStatus(tx: Tx, id: string, status: ArtifactStatus, at: number): void {
  tx.update(artifact).set({ status, updatedAt: at }).where(eq(artifact.id, id)).run()
}

export function insertAnnotation(tx: Tx, input: Annotation): void {
  tx.insert(annotation)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      deliveryId: input.deliveryId,
      stageKey: input.stageKey,
      targetNodeIdsJson: JSON.stringify(input.targetNodeIds),
      targetArtifactId: input.targetArtifactId,
      note: input.note,
      strokesJson: input.strokesJson,
      bboxJson: JSON.stringify(input.bbox),
      imagePath: input.imagePath,
      status: input.status,
      taskId: input.taskId,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      resolvedAt: input.resolvedAt,
    })
    .run()
}

export function getAnnotation(db: Db, id: string): Annotation | null {
  const row = db.select().from(annotation).where(eq(annotation.id, id)).get()
  return row ? toAnnotation(row) : null
}

export function listAnnotations(
  db: Db,
  filter: { deliveryId: string; stageKey?: string; status?: AnnotationStatus },
): Annotation[] {
  const clauses = [eq(annotation.deliveryId, filter.deliveryId)]
  if (filter.stageKey) clauses.push(eq(annotation.stageKey, filter.stageKey))
  if (filter.status) clauses.push(eq(annotation.status, filter.status))
  return db
    .select()
    .from(annotation)
    .where(and(...clauses))
    .orderBy(desc(annotation.createdAt))
    .all()
    .map(toAnnotation)
}

export function updateAnnotation(
  tx: Tx,
  id: string,
  patch: {
    note?: string
    status?: AnnotationStatus
    taskId?: string | null
    resolvedAt?: number | null
    updatedAt: number
  },
): void {
  tx.update(annotation)
    .set({
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.taskId !== undefined ? { taskId: patch.taskId } : {}),
      ...(patch.resolvedAt !== undefined ? { resolvedAt: patch.resolvedAt } : {}),
      updatedAt: patch.updatedAt,
    })
    .where(eq(annotation.id, id))
    .run()
}

export function resolveAnnotationsForTask(tx: Tx, taskId: string, at: number): string[] {
  const rows = tx
    .select()
    .from(annotation)
    .where(and(eq(annotation.taskId, taskId), eq(annotation.status, 'open')))
    .all()
  for (const row of rows) {
    updateAnnotation(tx, row.id, { status: 'resolved', resolvedAt: at, updatedAt: at })
  }
  return rows.map((row) => row.id)
}

export function parsePlaybookJson(value: string): Playbook {
  return JSON.parse(value) as Playbook
}
