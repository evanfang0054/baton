import type { Artifact } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { toast } from '@heroui/react/toast'
import { Excalidraw, exportToBlob, exportToSvg, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import { useEffect, useState } from 'react'
import { fetchArtifactText, saveArtifact } from '../../lib/api'
import { fileToBase64 } from '../../lib/file'
import { Overlay } from '../overlays/Overlay'

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!)
  }
  return btoa(binary)
}

export function DrawingEditor({
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
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [initialData, setInitialData] = useState<Record<string, unknown> | null>(null)
  const [loaded, setLoaded] = useState(!artifact.sourcePath)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!artifact.sourcePath) return
    let cancelled = false
    fetchArtifactText(deliveryId, artifact.id, 'source')
      .then((text) => {
        if (!cancelled) setInitialData(JSON.parse(text) as Record<string, unknown>)
      })
      .catch(() => {
        if (!cancelled) setInitialData(null)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [artifact.id, artifact.sourcePath, deliveryId])

  const save = async (close: boolean) => {
    if (!api) return
    setSaving(true)
    try {
      const elements = api.getSceneElements()
      const appState = api.getAppState()
      const files = api.getFiles()
      const source = serializeAsJSON(elements, appState, files, 'local')
      const png = await exportToBlob({ elements, appState, files, mimeType: 'image/png' })
      const svg = await exportToSvg({ elements, appState, files })
      const svgText = new XMLSerializer().serializeToString(svg)
      await saveArtifact(deliveryId, artifact.id, {
        sourceBase64: await fileToBase64(new File([source], 'scene.excalidraw')),
        previewBase64: await blobToBase64(png),
        svgBase64: await fileToBase64(new File([svgText], 'scene.svg')),
      })
      onSaved?.()
      if (close) onClose()
      else toast.success('画板已保存')
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '保存画板失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Overlay title={`画板 · ${artifact.name}`} onClose={() => void save(true)} width="96vw">
      <div className="mb-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          isDisabled={saving || !api}
          onPress={() => void save(false)}
        >
          {saving ? '保存中…' : '保存'}
        </Button>
        <Button
          size="sm"
          variant="tertiary"
          isDisabled={saving || !api}
          onPress={() => void save(true)}
        >
          保存并关闭
        </Button>
        <span className="text-xs text-muted">画板会保存为 .excalidraw + PNG + SVG</span>
      </div>
      <div className="h-[72vh] overflow-hidden rounded-lg border border-separator bg-surface">
        {loaded ? (
          <Excalidraw
            excalidrawAPI={setApi}
            theme="dark"
            initialData={initialData ?? undefined}
            UIOptions={{ canvasActions: { loadScene: false } }}
          />
        ) : (
          <p className="p-4 text-sm text-muted">正在加载画板…</p>
        )}
      </div>
    </Overlay>
  )
}
