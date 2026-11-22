import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MobileMoreMenu } from './MobileMoreMenu'

describe('MobileMoreMenu', () => {
  it('opens actions from the more menu', async () => {
    const onOpenTask = vi.fn()
    render(
      <MobileMoreMenu
        open
        onOpenChange={() => {}}
        onOpenTask={onOpenTask}
        onOpenNodes={() => {}}
        onCreateWorkspace={() => {}}
        automationSlot={<div>自动化区</div>}
        trustSlot={<div>信任区</div>}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '新建任务' }))
    expect(onOpenTask).toHaveBeenCalled()
    expect(screen.getByText('自动化区')).toBeInTheDocument()
    expect(screen.getByText('信任区')).toBeInTheDocument()
  })
})
