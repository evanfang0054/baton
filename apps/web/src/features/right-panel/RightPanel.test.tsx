import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RightPanel } from './RightPanel'

describe('RightPanel', () => {
  it('renders as an overlay when compact', () => {
    render(<RightPanel compact supervisor={<div>总管</div>} />)
    const panel = screen.getByTestId('right-panel')
    expect(panel.className).toContain('absolute')
    expect(panel.className).toContain('shadow-overlay')
  })

  it('only renders the supervisor, with no task or node tabs', () => {
    render(<RightPanel supervisor={<div>总管内容</div>} />)
    expect(screen.getByText('总管内容')).toBeVisible()
    expect(screen.queryByRole('tab', { name: '任务' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '节点' })).not.toBeInTheDocument()
    expect(screen.getByText('精灵总管')).toBeVisible()
  })

  it('shows an unread notice and can collapse', async () => {
    const onToggleCollapsed = vi.fn()
    render(
      <RightPanel
        hasUnreadNotice
        onToggleCollapsed={onToggleCollapsed}
        supervisor={<div>总管内容</div>}
      />,
    )
    expect(screen.getByText('有未读汇报')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '收起总管' }))
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1)
  })

  it('renders a restore button when collapsed', async () => {
    const onToggleCollapsed = vi.fn()
    render(
      <RightPanel
        collapsed
        onToggleCollapsed={onToggleCollapsed}
        supervisor={<div>总管内容</div>}
      />,
    )
    expect(screen.queryByText('总管内容')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '展开总管' }))
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1)
  })
})
