import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RightPanel } from './RightPanel'

describe('RightPanel', () => {
  it('shows supervisor by default and switches tabs', async () => {
    const onModeChange = vi.fn()
    render(
      <RightPanel
        mode="supervisor"
        onModeChange={onModeChange}
        hasTask
        hasNode
        supervisor={<div>总管内容</div>}
        task={<div>任务内容</div>}
        node={<div>节点内容</div>}
      />,
    )
    expect(screen.getByText('总管内容')).toBeVisible()
    expect(screen.getByRole('tab', { name: '总管' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('tab', { name: '任务' }))
    expect(onModeChange).toHaveBeenCalledWith('task')
  })

  it('falls back to supervisor when the selected tab is unavailable', () => {
    render(
      <RightPanel
        mode="task"
        onModeChange={vi.fn()}
        hasTask={false}
        hasNode={false}
        supervisor={<div>总管内容</div>}
        task={null}
        node={null}
      />,
    )
    expect(screen.getByText('总管内容')).toBeVisible()
    expect(screen.queryByRole('tab', { name: '任务' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '节点' })).not.toBeInTheDocument()
  })
})
