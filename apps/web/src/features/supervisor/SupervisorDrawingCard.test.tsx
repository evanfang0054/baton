import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SupervisorDrawingCard } from './SupervisorDrawingCard'

const card = {
  artifactId: 'a1',
  deliveryId: 'd1',
  nodeId: 'n1',
  title: '流程草图',
  elements: 5,
  texts: 2,
  previewStale: true,
}

describe('SupervisorDrawingCard', () => {
  it('shows counts and opens the drawing', async () => {
    const onOpen = vi.fn()
    render(<SupervisorDrawingCard card={card} onOpen={onOpen} />)
    const section = screen.getByRole('region', { name: '画板 流程草图' })
    expect(within(section).getByText('元素 5 个 · 文字 2 段 · 预览生成中')).toBeVisible()
    expect(within(section).getByRole('img', { name: '流程草图 缩略图' })).toBeVisible()
    await userEvent.click(within(section).getByRole('button', { name: '打开画板' }))
    expect(onOpen).toHaveBeenCalledWith('d1', 'a1')
  })
})
