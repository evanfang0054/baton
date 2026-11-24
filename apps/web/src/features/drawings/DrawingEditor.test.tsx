import type { Artifact } from '@baton/protocol'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchArtifactText, saveArtifact, ApiError } from '../../lib/api'
import { DrawingEditor } from './DrawingEditor'

vi.mock('@excalidraw/excalidraw', async () => {
  const { useEffect } = await import('react')
  const api = {
    getSceneElements: () => [
      { id: 'e1', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'hello' },
    ],
    getAppState: () => ({}),
    getFiles: () => ({}),
  }
  return {
    Excalidraw: ({
      excalidrawAPI,
      onChange,
    }: {
      excalidrawAPI: (value: unknown) => void
      onChange: () => void
    }) => {
      useEffect(() => {
        excalidrawAPI(api)
      }, [excalidrawAPI])
      return (
        <button type="button" onClick={onChange}>
          fake edit
        </button>
      )
    },
    serializeAsJSON: () => '{"type":"excalidraw","elements":[]}',
    exportToBlob: async () => ({ arrayBuffer: async () => new Uint8Array([1]).buffer }) as Blob,
    exportToSvg: async () => document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
  }
})

vi.mock('../../lib/api', () => {
  class MockApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message)
    }
  }
  return {
    ApiError: MockApiError,
    fetchArtifactText: vi.fn(),
    saveArtifact: vi.fn(),
  }
})

vi.mock('../../lib/file', () => ({ fileToBase64: vi.fn(async () => 'c291cmNl') }))

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'a1',
    workspaceId: 'w1',
    deliveryId: 'd1',
    stageKey: 'requirement',
    taskId: null,
    kind: 'drawing',
    name: 'drawing.png',
    path: '.baton/deliveries/d1/requirement/drawing.png',
    sourcePath: null,
    svgPath: null,
    mime: 'image/png',
    size: 0,
    sha256: '0'.repeat(64),
    version: 1,
    status: 'draft',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function renderEditor(input = artifact(), onClose = vi.fn(), onSaved = vi.fn()) {
  render(
    <DrawingEditor deliveryId="d1" artifact={input} onClose={onClose} onSaved={onSaved} />,
  )
  return { onClose, onSaved }
}

describe('DrawingEditor', () => {
  beforeEach(() => {
    vi.mocked(fetchArtifactText).mockReset()
    vi.mocked(saveArtifact).mockReset()
    vi.mocked(saveArtifact).mockResolvedValue(artifact({ status: 'ready' }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads source and saves full on close', async () => {
    vi.mocked(fetchArtifactText).mockResolvedValue('{"type":"excalidraw","elements":[]}')
    const onClose = vi.fn()
    const onSaved = vi.fn()
    renderEditor(artifact({ sourcePath: 'drawing.excalidraw' }), onClose, onSaved)

    await screen.findByRole('button', { name: 'fake edit' })
    await userEvent.click(screen.getByRole('button', { name: '保存并关闭' }))

    await waitFor(() =>
      expect(saveArtifact).toHaveBeenCalledWith(
        'd1',
        'a1',
        expect.objectContaining({ mode: 'full' }),
      ),
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSaved).toHaveBeenCalled()
  })

  it('does not mount an editable board when loading fails', async () => {
    vi.mocked(fetchArtifactText).mockRejectedValue(new ApiError(500, 'http_error', 'boom'))
    const onClose = vi.fn()
    renderEditor(artifact({ sourcePath: 'drawing.excalidraw' }), onClose)

    expect(await screen.findByText(/画板加载失败/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'fake edit' })).not.toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalled()
    expect(saveArtifact).not.toHaveBeenCalled()
  })

  it('autosaves source after the debounce', async () => {
    vi.mocked(fetchArtifactText).mockResolvedValue('{"type":"excalidraw","elements":[]}')
    renderEditor(artifact({ sourcePath: 'drawing.excalidraw' }))

    await screen.findByRole('button', { name: 'fake edit' })
    await userEvent.click(screen.getByRole('button', { name: 'fake edit' }))

    await waitFor(
      () =>
        expect(saveArtifact).toHaveBeenCalledWith(
          'd1',
          'a1',
          expect.objectContaining({ mode: 'source' }),
        ),
      { timeout: 3500 },
    )
  })

  it('keeps the editor open and offers discard when full save fails', async () => {
    vi.mocked(fetchArtifactText).mockResolvedValue('{"type":"excalidraw","elements":[]}')
    vi.mocked(saveArtifact).mockRejectedValue(new Error('save failed'))
    const onClose = vi.fn()
    renderEditor(artifact({ sourcePath: 'drawing.excalidraw' }), onClose)

    await screen.findByRole('button', { name: 'fake edit' })
    await userEvent.click(screen.getByRole('button', { name: '保存并关闭' }))

    expect(await screen.findByText('放弃未保存修改？')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
