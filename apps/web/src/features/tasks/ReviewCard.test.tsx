import type { Review } from '@baton/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { ReviewCard } from './ReviewCard'

const review: Review = {
  id: 'r1',
  taskId: 't1',
  verdict: null,
  verifyExitCode: 0,
  verifyOutput: 'all good',
  diffStat: { filesChanged: 2, insertions: 10, deletions: 3 },
  decidedAt: null,
}

describe('ReviewCard', () => {
  it('requires feedback before rejecting', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    render(
      <CommandProvider send={send}>
        <ReviewCard review={review} onDone={vi.fn()} />
      </CommandProvider>,
    )

    expect(screen.getByText('退出码 0')).toBeInTheDocument()
    expect(screen.getByText('all good')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打回' }))

    const confirm = screen.getByRole('button', { name: '确认打回' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('打回反馈'), { target: { value: '缺少测试' } })
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'reject', feedback: '缺少测试' },
      }),
    )
  })

  it('approves with a single click', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    render(
      <CommandProvider send={send}>
        <ReviewCard review={review} onDone={vi.fn()} />
      </CommandProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '通过' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'approve' },
      }),
    )
  })
})
