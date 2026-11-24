import { lazy, Suspense } from 'react'
import type { Artifact } from '@baton/protocol'

const DrawingEditor = lazy(async () => {
  const module = await import('../drawings/DrawingEditor')
  return { default: module.DrawingEditor }
})

export function DrawingEditorOverlay({
  deliveryId,
  artifact,
  onClose,
  onSaved,
}: {
  deliveryId: string
  artifact: Artifact
  onClose: () => void
  onSaved?: () => void
}) {
  return (
    <Suspense fallback={<div className="fixed inset-0 z-50 bg-black/60" aria-hidden="true" />}>
      <DrawingEditor
        deliveryId={deliveryId}
        artifact={artifact}
        onClose={onClose}
        onSaved={onSaved}
      />
    </Suspense>
  )
}
