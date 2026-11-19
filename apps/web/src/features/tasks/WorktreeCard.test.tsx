import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanupWorktree } from '../../lib/api'
import { WorktreeCard } from './WorktreeCard'

vi.mock('../../lib/api', () => ({ cleanupWorktree: vi.fn() }))

afterEach(() => vi.mocked(cleanupWorktree).mockReset())

describe('WorktreeCard', () => {
  it('cleans the worktree after confirmation', async () => {
    vi.mocked(cleanupWorktree).mockResolvedValue(undefined)
    const onDone = vi.fn()
    render(<WorktreeCard taskId="t1" worktreePath="/tmp/wt" canCleanup onDone={onDone} />)
    expect(screen.getByText('baton/t1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清理工作树' }))
    fireEvent.click(screen.getByRole('button', { name: '确认清理' }))
    await waitFor(() => expect(cleanupWorktree).toHaveBeenCalledWith('t1'))
    expect(onDone).toHaveBeenCalled()
  })

  it('hides the cleanup action when not allowed and renders nothing without a worktree', () => {
    const { rerender } = render(
      <WorktreeCard taskId="t1" worktreePath="/tmp/wt" canCleanup={false} onDone={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: '清理工作树' })).not.toBeInTheDocument()
    rerender(<WorktreeCard taskId="t1" worktreePath={null} canCleanup onDone={vi.fn()} />)
    expect(screen.queryByTestId('worktree-card')).not.toBeInTheDocument()
  })
})
