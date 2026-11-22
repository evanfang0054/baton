import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const AnnotationStatus = z.enum(['open', 'resolved', 'dismissed'])
export type AnnotationStatus = z.infer<typeof AnnotationStatus>

export const AnnotationBBox = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
})
export type AnnotationBBox = z.infer<typeof AnnotationBBox>

export const Annotation = z.object({
  id: Id,
  workspaceId: Id,
  deliveryId: Id,
  stageKey: z.string().min(1).max(32),
  targetNodeIds: z.array(Id).max(20),
  targetArtifactId: Id.nullable(),
  note: z.string().max(2000),
  strokesJson: z.string().max(2_000_000),
  bbox: AnnotationBBox,
  imagePath: z.string().min(1).max(1024),
  status: AnnotationStatus,
  taskId: Id.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  resolvedAt: Timestamp.nullable(),
})
export type Annotation = z.infer<typeof Annotation>

export const AnnotationSummary = Annotation.pick({
  id: true,
  deliveryId: true,
  stageKey: true,
  targetNodeIds: true,
  targetArtifactId: true,
  note: true,
  bbox: true,
  imagePath: true,
  status: true,
  taskId: true,
  createdAt: true,
})
export type AnnotationSummary = z.infer<typeof AnnotationSummary>
