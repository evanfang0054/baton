import { describe, expect, it } from 'vitest'
import { createTestRuntime } from './helpers/runtime.js'

describe('budget command removal', () => {
  it('rejects task.set_budget as an unsupported command', async () => {
    const handle = createTestRuntime()
    const result = handle.runtime.handleCommand({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'task.set_budget',
      payload: { taskId: 'missing', budgetUsd: 3 },
    } as never)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('unsupported_command')
    await handle.cleanup()
  })
})
