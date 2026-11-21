import type { Node, ReviewView } from '@baton/protocol'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { useAppStore } from '../../stores/app'
import { ReviewCard } from './ReviewCard'

afterEach(() => useAppStore.setState({ selectedNodeIds: [], contextNodeIds: [] }))

const review: ReviewView = {
  id: 'r1',
  taskId: 't1',
  verdict: null,
  verifyExitCode: 0,
  verifyOutput: 'all good',
  diffStat: { filesChanged: 2, insertions: 10, deletions: 3 },
  decidedAt: null,
  diffAvailable: false,
  preliminaryVerdict: null,
  preliminaryReason: null,
  preliminaryAt: null,
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
        <ReviewCard
          review={review}
          acceptance={{
            contractId: 'ac1',
            version: 1,
            revision: 0,
            status: 'draft',
            counts: { total: 1, pass: 1, fail: 0, pending: 0, waived: 0 },
            verdict: 'pass',
            topFailures: [],
          }}
          onDone={vi.fn()}
        />
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

  it('requires confirmation when verify failed and sends an optional reason', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    render(
      <CommandProvider send={send}>
        <ReviewCard
          review={{ ...review, verifyExitCode: 1 }}
          usage={{ costUsd: 0.42, turns: 3 }}
          onDone={vi.fn()}
        />
      </CommandProvider>,
    )
    expect(screen.getByText('本次 $0.42 · 3 turns')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '通过' }))
    expect(send).not.toHaveBeenCalled()
    expect(screen.getByText('仍有验收项未通过，仍要通过吗？')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('通过理由'), { target: { value: '已知问题，先合' } })
    fireEvent.click(screen.getByRole('button', { name: '确认通过' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'approve', overrideReason: '已知问题，先合' },
      }),
    )
  })

  it('attaches the current canvas selection when rejecting', async () => {
    useAppStore.setState({ contextNodeIds: ['n1'] })
    const send = vi.fn().mockResolvedValue(undefined)
    render(
      <CommandProvider send={send}>
        <ReviewCard review={review} onDone={vi.fn()} />
      </CommandProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '打回' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '附带当前选中的 1 个节点' }))
    fireEvent.click(screen.getByRole('button', { name: '确认打回' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'reject', contextNodeIds: ['n1'] },
      }),
    )
  })

  it('ignores agent-only selections because they are not injectable', () => {
    useAppStore.setState({ contextNodeIds: ['a1'] })
    const agent: Node = {
      id: 'a1',
      canvasId: 'c1',
      type: 'agent',
      x: 0,
      y: 0,
      w: 320,
      h: 200,
      groupId: null,
      data: { title: 'Agent 1', engine: 'fake', taskId: null },
      createdAt: 1,
      updatedAt: 1,
    }
    render(
      <CommandProvider send={vi.fn()}>
        <ReviewCard review={review} contextNodes={[agent]} onDone={vi.fn()} />
      </CommandProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '打回' }))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认打回' })).toBeDisabled()
  })

  it('drops the attach flag when the selection is cleared', () => {
    useAppStore.setState({ contextNodeIds: ['n1'] })
    render(
      <CommandProvider send={vi.fn()}>
        <ReviewCard review={review} onDone={vi.fn()} />
      </CommandProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '打回' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '附带当前选中的 1 个节点' }))
    expect(screen.getByRole('button', { name: '确认打回' })).not.toBeDisabled()

    act(() => useAppStore.setState({ contextNodeIds: [] }))

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认打回' })).toBeDisabled()
  })

  it('shows preliminary verdict and keeps human gate', () => {
    render(
      <CommandProvider send={vi.fn()}>
        <ReviewCard
          review={{
            ...review,
            preliminaryVerdict: 'pass',
            preliminaryReason: '检查通过',
            preliminaryAt: 3,
          }}
          onDone={vi.fn()}
        />
      </CommandProvider>,
    )
    expect(screen.getByText(/初步验收：\s*PASS/)).toBeInTheDocument()
    expect(screen.getByText('检查通过')).toBeInTheDocument()
    expect(screen.getByText(/最终通过或打回由你决定/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '通过' })).toBeInTheDocument()
  })
})
