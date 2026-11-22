import type { AnnotationSummary } from '@baton/protocol'
import { escapeAttr } from '../context/assemble.js'

export type AnnotationContext = Pick<
  AnnotationSummary,
  'id' | 'note' | 'targetNodeIds' | 'targetArtifactId' | 'bbox' | 'imagePath'
> & { targetTitle?: string }

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function buildAnnotationBlock(annotations: AnnotationContext[]): string {
  if (annotations.length === 0) return ''
  const lines = annotations.map((annotation) => {
    const target =
      annotation.targetTitle ??
      annotation.targetArtifactId ??
      (annotation.targetNodeIds.length > 0 ? annotation.targetNodeIds.join(',') : 'stage')
    const bbox = `${annotation.bbox.x},${annotation.bbox.y},${annotation.bbox.w},${annotation.bbox.h}`
    return [
      `  <annotation id="${escapeAttr(annotation.id)}" note="${escapeAttr(annotation.note)}"`,
      ` target="${escapeAttr(target)}" bbox="${escapeAttr(bbox)}">`,
      `    <image src="${escapeAttr(annotation.imagePath)}"/>`,
      '  </annotation>',
    ].join('')
  })
  return ['<annotations>', ...lines, '</annotations>'].join('\n')
}
