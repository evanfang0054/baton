import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MobileMoreMenu } from './MobileMoreMenu'

describe('MobileMoreMenu', () => {
  it('opens actions from the more menu', async () => {
    const onOpenSettings = vi.fn()
    render(
      <MobileMoreMenu
        open
        onOpenChange={() => {}}
        onOpenSettings={onOpenSettings}
        onOpenTask={() => {}}
        onOpenNodes={() => {}}
        onCreateWorkspace={() => {}}
        automationSlot={<div>自动化区</div>}
        trustSlot={<div>信任区</div>}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '自动化设置' }))
    expect(onOpenSettings).toHaveBeenCalled()
    expect(screen.getByText('自动化区')).toBeInTheDocument()
    expect(screen.getByText('信任区')).toBeInTheDocument()
  })
})
