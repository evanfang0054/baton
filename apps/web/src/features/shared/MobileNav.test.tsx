import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MobileNav } from './MobileNav'

describe('MobileNav', () => {
  it('marks the active tab and switches', async () => {
    const onChange = vi.fn()
    render(<MobileNav tab="board" onChange={onChange} attentionCount={2} unread />)

    const nav = screen.getByRole('navigation', { name: '移动端导航' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /看板/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /总管/ })).not.toHaveAttribute('aria-current')

    await userEvent.click(screen.getByRole('button', { name: /总管/ }))
    expect(onChange).toHaveBeenCalledWith('supervisor')
  })

  it('shows attention count and unread dot with accessible text', () => {
    render(<MobileNav tab="board" onChange={() => {}} attentionCount={12} unread />)
    expect(screen.getByText('9+')).toBeInTheDocument()
    expect(screen.getByText('有未读汇报')).toBeInTheDocument()
  })
})
