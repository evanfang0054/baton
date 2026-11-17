import { useState } from 'react'
import { useCommand } from '../../lib/command-context'
import type { CommandInput } from '../../lib/ws'

export function useCommandAction(onDone: () => Promise<void> | void) {
  const send = useCommand()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (input: CommandInput) => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await send(input)
      await onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败')
    } finally {
      setPending(false)
    }
  }

  return { run, pending, error, clearError: () => setError(null) }
}
