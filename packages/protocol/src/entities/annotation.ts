import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const AnnotationStatus = z.enum(['open', 'resolved', 'dismissed'])
export type AnnotationStatus = z.infer<typeof AnnotationStatus>

/**
 * screen: 旧数据，bbox 是创建时的画布视口坐标，平移/缩放后无法还原。
 * flow: 新数据，bbox 是 React Flow 世界坐标，可随视口正确重绘，也能和节点矩形比较。
 */
export const AnnotationCoordinateSpace = z.enum(['screen', 'flow'])
export type AnnotationCoordinateSpace = z.infer<typeof AnnotationCoordinateSpace>

export function annotationCoordinateSpace(strokesJson: string): AnnotationCoordinateSpace {
  try {
    const parsed = JSON.parse(strokesJson) as { coordinateSpace?: unknown }
    return parsed.coordinateSpace === 'flow' ? 'flow' : 'screen'
  } catch {
    return 'screen'
  }
}

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
  /** 为空表示工作区级标注；非空表示交付阶段标注。 */
  deliveryId: Id.nullable(),
  stageKey: z.string().min(1).max(32).nullable(),
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
  workspaceId: true,
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
}).extend({
  coordinateSpace: AnnotationCoordinateSpace.default('screen'),
})
export type AnnotationSummary = z.infer<typeof AnnotationSummary>
