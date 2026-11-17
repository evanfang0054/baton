import { describe, expect, it } from 'vitest'
import { createScheduler, type SchedulerRuntime } from '../src/runtime/scheduler.js'
import type { TransitionOutcome } from '../src/runtime/types.js'

function queueRuntime(
  tasks: string[],
  failing: Set<string>,
): SchedulerRuntime & {
  started: string[]
  attempts: string[]
} {
  const started: string[] = []
  const attempts: string[] = []
  let active = 0
  return {
    maxConcurrency: 1,
    started,
    attempts,
    countActiveTasks: () => active,
    findNextQueued: (exclude) => {
      const next = tasks.find((id) => !exclude?.has(id))
      return next ? { id: next } : null
    },
    applyTransition: (taskId): TransitionOutcome => {
      attempts.push(taskId)
      if (failing.has(taskId)) {
        return { ok: false, error: { code: 'invalid_policy', message: 'boom' } }
      }
      started.push(taskId)
      active += 1
      return {
        ok: true,
        taskId,
        status: 'running',
        previousStatus: 'queued',
        retryCount: 0,
        events: [],
      }
    },
  }
}

describe('scheduler', () => {
  it('skips a task that fails to start instead of blocking the queue', () => {
    const runtime = queueRuntime(['bad', 'good'], new Set(['bad']))
    const scheduler = createScheduler(runtime)

    scheduler.pump()

    expect(runtime.attempts).toEqual(['bad', 'good'])
    expect(runtime.started).toEqual(['good'])
  })

  it('stops after all queued candidates failed once', () => {
    const runtime = queueRuntime(['bad', 'worse'], new Set(['bad', 'worse']))
    const scheduler = createScheduler(runtime)

    scheduler.pump()

    expect(runtime.attempts).toEqual(['bad', 'worse'])
    expect(runtime.started).toEqual([])
  })
})
