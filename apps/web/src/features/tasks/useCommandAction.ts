import { useState } from 'react'
import { useCommand } from '../../lib/command-context'
import type { CommandInput } from '../../lib/ws'

export function useCommandAction(onDone: () => Promise<void> | void) {
  const send = useCommand()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const run = async (input: CommandInput): Promise<boolean> => {
    if (pending) return false
    setPending(true)
    setError(null)
    setErrorCode(null)
    try {
      await send(input)
      await onDone()
      return true
    } catch (cause) {
      const code = (cause as { code?: unknown } | null)?.code
      const normalized = typeof code === 'string' ? code : null
      // 已决策/已过期说明目标状态已达成，按幂等成功处理，避免重复点击显示假错误。
      if (
        normalized === 'already_decided' ||
        normalized === 'approval_expired' ||
        normalized === 'review_expired'
      ) {
        await onDone()
        return true
      }
      setError(cause instanceof Error ? cause.message : '操作失败')
      setErrorCode(normalized)
      return false
    } finally {
      setPending(false)
    }
  }

  return {
    run,
    pending,
    error,
    errorCode,
    clearError: () => {
      setError(null)
      setErrorCode(null)
    },
  }
}
