import type { Artifact } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { toast } from '@heroui/react/toast'
import { Excalidraw, exportToBlob, exportToSvg, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, fetchArtifactText, saveArtifact } from '../../lib/api'
import { fileToBase64 } from '../../lib/file'
import { useDrawingStore } from './drawing-store'
import { ConfirmDialog } from '../overlays/ConfirmDialog'
import { Overlay } from '../overlays/Overlay'

type LoadState = 'loading' | 'ready' | 'error'
type SaveMode = 'source' | 'full'

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!)
  }
  return btoa(binary)
}

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 413) return '画板内容过大，请减少图片或笔迹后重试'
    return cause.message
  }
  return cause instanceof Error ? cause.message : '画板保存失败'
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
  const [loadState, setLoadState] = useState<LoadState>(artifact.sourcePath ? 'loading' : 'ready')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const conflict = useDrawingStore((state) => state.conflicts[artifact.id] === true)
  const clearConflict = useDrawingStore((state) => state.clearConflict)

  const autosaveTimer = useRef<number | null>(null)
  const inFlight = useRef<Promise<boolean> | null>(null)
  const pending = useRef(false)
  const changeSeq = useRef(0)
  const savedSeq = useRef(0)
  const saveNowRef = useRef<(mode: SaveMode) => Promise<boolean>>(async () => false)

  useEffect(() => {
    if (loadState !== 'loading') return
    if (!artifact.sourcePath) {
      setLoadState('ready')
      return
    }
    let cancelled = false
    setLoadError(null)
    fetchArtifactText(deliveryId, artifact.id, 'source')
      .then((text) => {
        if (cancelled) return
        setInitialData(JSON.parse(text) as Record<string, unknown>)
        setLoadState('ready')
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setLoadError(errorMessage(cause))
        setLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [artifact.id, artifact.sourcePath, deliveryId, loadState])

  useEffect(
    () => () => {
      if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current)
      autosaveTimer.current = null
    },
    [],
  )

  useEffect(() => {
    useDrawingStore.getState().beginEditing(artifact.id)
    return () => {
      useDrawingStore.getState().endEditing(artifact.id)
      useDrawingStore.getState().clearConflict(artifact.id)
    }
  }, [artifact.id])

  const loadLatest = async () => {
    if (!api) return
    try {
      const text = await fetchArtifactText(deliveryId, artifact.id, 'source')
      const parsed = JSON.parse(text) as {
        elements?: never
        appState?: never
        files?: never
      }
      api.updateScene({
        elements: parsed.elements ?? [],
        ...(parsed.appState ? { appState: parsed.appState } : {}),
        ...(parsed.files ? { files: parsed.files } : {}),
      })
      changeSeq.current += 1
      savedSeq.current = changeSeq.current
      setDirty(false)
      setSaveError(null)
      clearConflict(artifact.id)
      toast.success('已加载最新画板')
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '加载最新画板失败')
    }
  }

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const saveNow = useCallback(
    async (mode: SaveMode): Promise<boolean> => {
      if (!api || loadState !== 'ready') return false
      if (inFlight.current) {
        pending.current = true
        return false
      }
      const seq = changeSeq.current
      const promise = (async () => {
        setSaving(true)
        setSaveError(null)
        try {
          const elements = api.getSceneElements()
          const appState = api.getAppState()
          const files = api.getFiles()
          const source = serializeAsJSON(elements, appState, files, 'local')
          if (mode === 'source') {
            await saveArtifact(deliveryId, artifact.id, {
              mode: 'source',
              sourceBase64: await fileToBase64(new File([source], 'scene.excalidraw')),
            })
          } else {
            const png = await exportToBlob({ elements, appState, files, mimeType: 'image/png' })
            const svg = await exportToSvg({ elements, appState, files })
            const svgText = new XMLSerializer().serializeToString(svg)
            await saveArtifact(deliveryId, artifact.id, {
              mode: 'full',
              sourceBase64: await fileToBase64(new File([source], 'scene.excalidraw')),
              previewBase64: await blobToBase64(png),
              svgBase64: await fileToBase64(new File([svgText], 'scene.svg')),
            })
          }
          savedSeq.current = seq
          if (seq === changeSeq.current) {
            setDirty(false)
            pending.current = false
          }
          setLastSavedAt(Date.now())
          return true
        } catch (cause) {
          const message = errorMessage(cause)
          setSaveError(message)
          toast.danger(message)
          return false
        } finally {
          setSaving(false)
          inFlight.current = null
          if (pending.current) {
            pending.current = false
            window.setTimeout(() => void saveNowRef.current('source'), 0)
          }
        }
      })()
      inFlight.current = promise
      return promise
    },
    [api, artifact.id, deliveryId, loadState],
  )
  saveNowRef.current = saveNow

  const handleChange = useCallback(() => {
    if (loadState !== 'ready') return
    changeSeq.current += 1
    setDirty(true)
    setSaveError(null)
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current)
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = null
      void saveNowRef.current('source')
    }, 2000)
  }, [loadState])

  const requestClose = useCallback(async () => {
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current)
      autosaveTimer.current = null
    }
    if (loadState !== 'ready' || !api) {
      onClose()
      return
    }
    if (inFlight.current) await inFlight.current
    pending.current = false
    const saved = await saveNowRef.current('full')
    if (saved) {
      onSaved?.()
      onClose()
      return
    }
    setDiscardOpen(true)
  }, [api, loadState, onClose, onSaved])

  const explicitSave = async () => {
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current)
      autosaveTimer.current = null
    }
    if (await saveNowRef.current('full')) {
      onSaved?.()
      toast.success('画板已保存')
    }
  }

  const canSave = loadState === 'ready' && Boolean(api) && !saving
  const status = saving
    ? '保存中…'
    : dirty
      ? '有未保存修改'
      : lastSavedAt
        ? `已保存 ${new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
        : '已保存'

  return (
    <>
      <Overlay
        title={`画板 · ${artifact.name}`}
        onClose={() => void requestClose()}
        closeOnEscape={false}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            isDisabled={!canSave}
            onPress={() => void explicitSave()}
          >
            {saving ? '保存中…' : '保存'}
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            isDisabled={!canSave}
            onPress={() => void requestClose()}
          >
            保存并关闭
          </Button>
          <span className="text-xs text-muted">画板会保存为 .excalidraw + PNG + SVG</span>
          <span className={dirty ? 'text-xs text-warning' : 'text-xs text-muted'}>{status}</span>
        </div>
        {conflict ? (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
          >
            <p className="font-medium">总管已更新这个画板</p>
            <p className="mt-1 text-muted">
              加载最新会放弃你本地当前修改；保留本地会在下次保存时覆盖远端。
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" onPress={() => void loadLatest()}>
                加载最新
              </Button>
              <Button size="sm" variant="tertiary" onPress={() => clearConflict(artifact.id)}>
                保留本地
              </Button>
            </div>
          </div>
        ) : null}
        {saveError ? (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            保存失败：{saveError}
          </div>
        ) : null}
        {loadState === 'error' ? (
          <div
            role="alert"
            className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-lg border border-danger/40 bg-danger/5 p-6 text-center"
          >
            <p className="text-sm text-danger">画板加载失败：{loadError ?? '未知错误'}</p>
            <p className="text-xs text-muted">为避免覆盖已保存内容，当前不允许编辑或保存。</p>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onPress={() => setLoadState('loading')}>
                重试
              </Button>
              <Button size="sm" variant="tertiary" onPress={onClose}>
                关闭
              </Button>
            </div>
          </div>
        ) : loadState === 'loading' ? (
          <p className="p-4 text-sm text-muted">正在加载画板…</p>
        ) : (
          <div className="h-[72vh] overflow-hidden rounded-lg border border-separator bg-surface">
            <Excalidraw
              excalidrawAPI={setApi}
              theme="dark"
              langCode="zh-CN"
              initialData={initialData ?? undefined}
              onChange={handleChange}
              UIOptions={{ canvasActions: { loadScene: false } }}
            />
          </div>
        )}
      </Overlay>
      <ConfirmDialog
        open={discardOpen}
        title="放弃未保存修改？"
        description="保存没有成功。关闭后本次修改会丢失，已保存的内容仍保留。"
        confirmLabel="放弃并关闭"
        onConfirm={async () => {
          setDiscardOpen(false)
          onClose()
        }}
        onOpenChange={setDiscardOpen}
      />
    </>
  )
}
