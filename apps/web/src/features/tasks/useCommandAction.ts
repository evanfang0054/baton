import { useState } from 'react'
import { useCommand } from '../../lib/command-context'
import type { CommandInput } from '../../lib/ws'

export function useCommandAction(onDone: () => Promise<void> | void) {
  const send = useCommand()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const run = async (input: CommandInput) => {
    if (pending) return
    setPending(true)
    setError(null)
    setErrorCode(null)
    try {
      await send(input)
      await onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败')
      const code = (cause as { code?: unknown } | null)?.code
      setErrorCode(typeof code === 'string' ? code : null)
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
