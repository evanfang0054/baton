import type { TaskStatus } from '@baton/protocol'
import { expect } from 'vitest'
import type { TransitionContext, TransitionResult } from '../src/state-machine/types.js'

export const ctx = (
  status: TaskStatus,
  overrides: Partial<TransitionContext> = {},
): TransitionContext => ({
  status,
  retryCount: 0,
  runningCount: 0,
  maxConcurrency: 1,
  autopilot: { enabled: false, retryMax: 2 },
  workspaceTrusted: true,
  killSwitch: false,
  waitingReason: null,
  ...overrides,
})

export const diff = { filesChanged: 1, insertions: 2, deletions: 0 }

export function expectOk(result: TransitionResult) {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`)
  return result
}
