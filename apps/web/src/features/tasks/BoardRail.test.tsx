import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BoardRail } from './BoardRail'

describe('BoardRail', () => {
  it('renders attention counts and toggles the board', () => {
    const onToggle = vi.fn()
    render(
      <BoardRail
        counts={{ needs_me: 4, needs_approval: 2, needs_reply: 1, needs_review: 3 }}
        total={6}
        expanded={false}
        onToggle={onToggle}
        pinned={false}
        onTogglePin={vi.fn()}
      />,
    )
    expect(screen.getByText('需要我')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('展开看板'))
    expect(onToggle).toHaveBeenCalled()
  })
})
