import type { AnnotationSummary } from '@baton/protocol'
import { Overlay } from './Overlay'

export function AnnotationListOverlay({
  annotations,
  onClose,
  onLocate,
}: {
  annotations: AnnotationSummary[]
  onClose: () => void
  onLocate?: (annotation: AnnotationSummary) => void
}) {
  return (
    <Overlay title="标注" onClose={onClose} width="min(720px, 92vw)">
      {annotations.length === 0 ? (
        <p className="text-sm text-muted">当前交付还没有标注。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {annotations.map((annotation) => (
            <li
              key={annotation.id}
              className="rounded-lg border border-separator bg-surface p-3 text-sm"
            >
              <div className="flex items-center gap-2 text-xs text-muted">
                <span>{annotation.stageKey}</span>
                <span>{annotation.status}</span>
                <span className="font-mono">
                  {annotation.bbox.x},{annotation.bbox.y},{annotation.bbox.w},{annotation.bbox.h}
                </span>
                {onLocate ? (
                  <button
                    type="button"
                    onClick={() => onLocate(annotation)}
                    className="ml-auto underline underline-offset-2 hover:text-foreground"
                  >
                    定位
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-foreground">{annotation.note || '（无说明）'}</p>
              <p className="mt-1 truncate font-mono text-[11px] text-muted">
                {annotation.targetNodeIds.length > 0
                  ? `节点 ${annotation.targetNodeIds.join(', ')}`
                  : annotation.targetArtifactId
                    ? `产物 ${annotation.targetArtifactId}`
                    : '阶段'}
                {annotation.imagePath ? ` · ${annotation.imagePath}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Overlay>
  )
}
