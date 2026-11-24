import { fetchArtifactText, saveArtifact } from '../../lib/api'
import { isDrawingEditing } from './drawing-store'

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!)
  }
  return btoa(binary)
}

interface PreviewJob {
  deliveryId: string
  artifactId: string
  attempt: number
}

export interface PreviewRendererDeps {
  isEditing: (artifactId: string) => boolean
  render: (source: string) => Promise<string>
  save: (deliveryId: string, artifactId: string, previewBase64: string) => Promise<void>
  load: (deliveryId: string, artifactId: string) => Promise<string>
  retryDelay: (attempt: number) => Promise<void>
  onError?: (error: unknown, artifactId: string) => void
}

export interface PreviewQueue {
  enqueue(deliveryId: string, artifactId: string): void
  drain(): Promise<void>
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function renderScene(source: string): Promise<string> {
  const scene = JSON.parse(source) as {
    elements?: never
    appState?: never
    files?: never
  }
  // 动态导入保证 Excalidraw 仍只在画板相关路径加载。
  const { exportToBlob } = await import('@excalidraw/excalidraw')
  const blob = await exportToBlob({
    elements: scene.elements ?? [],
    appState: scene.appState ?? {},
    files: scene.files ?? {},
    mimeType: 'image/png',
  })
  return blobToBase64(blob)
}

export function createPreviewQueue(overrides: Partial<PreviewRendererDeps> = {}): PreviewQueue {
  const deps: PreviewRendererDeps = {
    isEditing: isDrawingEditing,
    render: renderScene,
    save: async (deliveryId, artifactId, previewBase64) => {
      await saveArtifact(deliveryId, artifactId, { mode: 'preview', previewBase64 })
    },
    load: (deliveryId, artifactId) => fetchArtifactText(deliveryId, artifactId, 'source'),
    retryDelay: (attempt) => sleep(500 * attempt),
    ...overrides,
  }
  const jobs: PreviewJob[] = []
  const queued = new Set<string>()
  let running = false

  async function runJob(job: PreviewJob): Promise<void> {
    if (deps.isEditing(job.artifactId)) return
    try {
      const source = await deps.load(job.deliveryId, job.artifactId)
      if (deps.isEditing(job.artifactId)) return
      const preview = await deps.render(source)
      if (deps.isEditing(job.artifactId)) return
      await deps.save(job.deliveryId, job.artifactId, preview)
    } catch (error) {
      if (job.attempt < 2) {
        await deps.retryDelay(job.attempt + 1)
        jobs.push({ ...job, attempt: job.attempt + 1 })
        return
      }
      deps.onError?.(error, job.artifactId)
    }
  }

  async function run(): Promise<void> {
    if (running) return
    running = true
    try {
      while (jobs.length > 0) {
        const job = jobs.shift()!
        await runJob(job)
        queued.delete(`${job.deliveryId}:${job.artifactId}`)
      }
    } finally {
      running = false
    }
  }

  return {
    enqueue(deliveryId, artifactId) {
      if (!deliveryId || !artifactId || deps.isEditing(artifactId)) return
      const key = `${deliveryId}:${artifactId}`
      if (queued.has(key)) return
      queued.add(key)
      jobs.push({ deliveryId, artifactId, attempt: 0 })
      void run()
    },
    async drain() {
      while (running || jobs.length > 0) {
        await run()
        await Promise.resolve()
      }
    },
  }
}

export const previewQueue = createPreviewQueue({
  onError: (error, artifactId) => {
    console.warn('[drawing-preview] render failed', artifactId, error)
  },
})
