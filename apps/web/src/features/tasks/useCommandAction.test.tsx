import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { useCommandAction } from './useCommandAction'

function wrapper(send: (input: unknown) => Promise<void>) {
  return ({ children }: { children: ReactNode }) => (
    <CommandProvider send={send as never}>{children}</CommandProvider>
  )
}

describe('useCommandAction', () => {
  it('runs the command and refreshes on success', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const onDone = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useCommandAction(onDone), { wrapper: wrapper(send) })

    let ok = false
    await act(async () => {
      ok = await result.current.run({
        type: 'approval.decide',
        payload: { approvalId: 'a1', decision: 'allow' },
      })
    })
    expect(ok).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBeNull()
  })

  it('treats already_decided as idempotent success', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('already decided'), { code: 'already_decided' }))
    const onDone = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useCommandAction(onDone), { wrapper: wrapper(send) })

    let ok = false
    await act(async () => {
      ok = await result.current.run({
        type: 'approval.decide',
        payload: { approvalId: 'a1', decision: 'allow' },
      })
    })
    expect(ok).toBe(true)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBeNull()
  })

  it('surfaces review_expired instead of hiding it as success', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('review expired'), { code: 'review_expired' }))
    const onDone = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useCommandAction(onDone), { wrapper: wrapper(send) })

    let ok = true
    await act(async () => {
      ok = await result.current.run({
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'approve' },
      })
    })
    expect(ok).toBe(false)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(result.current.error).toContain('新一轮')
  })
})
