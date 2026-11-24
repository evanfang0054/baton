import { describe, expect, it, vi } from 'vitest'
import { createPreviewQueue, type PreviewRendererDeps } from './preview-renderer'

function setup(overrides: Partial<PreviewRendererDeps> = {}) {
  const load = vi.fn().mockResolvedValue('{"type":"excalidraw","elements":[]}')
  const render = vi.fn().mockResolvedValue('cHJldmlldw==')
  const save = vi.fn().mockResolvedValue(undefined)
  const queue = createPreviewQueue({
    isEditing: () => false,
    load,
    render,
    save,
    retryDelay: async () => undefined,
    ...overrides,
  })
  return { queue, load, render, save }
}

describe('drawing preview queue', () => {
  it('dedupes queued artifacts and saves a preview', async () => {
    const { queue, load, render, save } = setup()
    queue.enqueue('d1', 'a1')
    queue.enqueue('d1', 'a1')
    await queue.drain()
    expect(load).toHaveBeenCalledTimes(1)
    expect(render).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('d1', 'a1', 'cHJldmlldw==')
  })

  it('skips artifacts that are being edited', async () => {
    const { queue, load, save } = setup({ isEditing: (id) => id === 'a1' })
    queue.enqueue('d1', 'a1')
    await queue.drain()
    expect(load).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('retries a failed render before giving up', async () => {
    const render = vi
      .fn()
      .mockRejectedValueOnce(new Error('render failed'))
      .mockResolvedValue('cHJldmlldw==')
    const onError = vi.fn()
    const { queue, save } = setup({ render, onError })
    queue.enqueue('d1', 'a1')
    await queue.drain()
    expect(render).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })
})
