import type { AnnotationBBox, AnnotationSummary } from '@baton/protocol'
import { escapeAttr } from '../context/assemble.js'

export interface AnnotationRegion {
  x: number
  y: number
  w: number
  h: number
}

export type AnnotationContext = Pick<
  AnnotationSummary,
  'id' | 'note' | 'targetNodeIds' | 'targetArtifactId' | 'bbox' | 'imagePath'
> & { targetTitle?: string; targetRegion?: AnnotationRegion }

/** 圈选区域相对目标节点的百分比（0-100），用于告诉总管/Agent 具体改了哪一块。 */
export function annotationRegion(
  bbox: AnnotationBBox,
  node: { x: number; y: number; w: number; h: number },
): AnnotationRegion | null {
  if (node.w <= 0 || node.h <= 0) return null
  const left = Math.max(bbox.x, node.x)
  const top = Math.max(bbox.y, node.y)
  const right = Math.min(bbox.x + bbox.w, node.x + node.w)
  const bottom = Math.min(bbox.y + bbox.h, node.y + node.h)
  if (right <= left || bottom <= top) return null
  const percent = (value: number) => Math.round(value * 100)
  return {
    x: percent((left - node.x) / node.w),
    y: percent((top - node.y) / node.h),
    w: percent((right - left) / node.w),
    h: percent((bottom - top) / node.h),
  }
}

export function buildAnnotationBlock(annotations: AnnotationContext[]): string {
  if (annotations.length === 0) return ''
  const lines = annotations.map((annotation) => {
    const target =
      annotation.targetTitle ??
      annotation.targetArtifactId ??
      (annotation.targetNodeIds.length > 0 ? annotation.targetNodeIds.join(',') : 'stage')
    const bbox = `${annotation.bbox.x},${annotation.bbox.y},${annotation.bbox.w},${annotation.bbox.h}`
    const region = annotation.targetRegion
      ? ` region="${annotation.targetRegion.x},${annotation.targetRegion.y},${annotation.targetRegion.w},${annotation.targetRegion.h}"`
      : ''
    return [
      `  <annotation id="${escapeAttr(annotation.id)}" note="${escapeAttr(annotation.note)}"`,
      ` target="${escapeAttr(target)}" bbox="${escapeAttr(bbox)}"${region}>`,
      `    <image src="${escapeAttr(annotation.imagePath)}"/>`,
      '  </annotation>',
    ].join('')
  })
  return ['<annotations>', ...lines, '</annotations>'].join('\n')
}
