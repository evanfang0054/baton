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
    const onInject = vi.fn()
    render(
      <CanvasToolbar
        onAdd={onAdd}
        onFit={onFit}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onInject={onInject}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '添加文本' }))
    await userEvent.click(screen.getByRole('button', { name: '添加文件' }))
    await userEvent.click(screen.getByRole('button', { name: '添加图片' }))
    await userEvent.click(screen.getByRole('button', { name: '建分组' }))
    await userEvent.click(screen.getByRole('button', { name: '添加 Agent' }))
    await userEvent.click(screen.getByRole('button', { name: '投喂给任务' }))
    await userEvent.click(screen.getByRole('button', { name: '适应视图' }))
    await userEvent.click(screen.getByRole('button', { name: '放大' }))
    await userEvent.click(screen.getByRole('button', { name: '缩小' }))

    expect(onAdd.mock.calls).toEqual([['text'], ['file'], ['image'], ['group'], ['agent']])
    expect(onInject).toHaveBeenCalled()
    expect(onFit).toHaveBeenCalled()
    expect(onZoomIn).toHaveBeenCalled()
    expect(onZoomOut).toHaveBeenCalled()
  })

  it('disables inject when the selection cannot be injected', () => {
    render(
      <CanvasToolbar
        onAdd={vi.fn()}
        onFit={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onInject={vi.fn()}
        injectDisabled
      />,
    )
    expect(screen.getByRole('button', { name: '投喂给任务' })).toBeDisabled()
  })

  it('hides write actions in read-only scene mode', () => {
    const onAdd = vi.fn()
    render(
      <CanvasToolbar
        onAdd={onAdd}
        onFit={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onInject={vi.fn()}
        readOnly
      />,
    )
    expect(screen.queryByRole('button', { name: '添加文本' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '投喂给任务' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '适应视图' })).toBeInTheDocument()
  })
})
