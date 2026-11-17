import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CanvasToolbar } from './CanvasToolbar'

describe('CanvasToolbar', () => {
  it('triggers add and viewport actions', async () => {
    const onAdd = vi.fn()
    const onFit = vi.fn()
    const onZoomIn = vi.fn()
    const onZoomOut = vi.fn()
    render(<CanvasToolbar onAdd={onAdd} onFit={onFit} onZoomIn={onZoomIn} onZoomOut={onZoomOut} />)

    await userEvent.click(screen.getByRole('button', { name: '添加文本' }))
    await userEvent.click(screen.getByRole('button', { name: '添加文件' }))
    await userEvent.click(screen.getByRole('button', { name: '添加 Agent' }))
    await userEvent.click(screen.getByRole('button', { name: '适应视图' }))
    await userEvent.click(screen.getByRole('button', { name: '放大' }))
    await userEvent.click(screen.getByRole('button', { name: '缩小' }))

    expect(onAdd.mock.calls).toEqual([['text'], ['file'], ['agent']])
    expect(onFit).toHaveBeenCalled()
    expect(onZoomIn).toHaveBeenCalled()
    expect(onZoomOut).toHaveBeenCalled()
  })
})
