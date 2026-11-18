import { describe, expect, it } from 'vitest'
import { createScheduler, type SchedulerRuntime } from '../src/runtime/scheduler.js'
import type { TransitionOutcome } from '../src/runtime/types.js'

function queueRuntime(
  tasks: string[],
  failing: Set<string>,
  live = 0,
  maxLiveSessions = 5,
): SchedulerRuntime & {
  started: string[]
  attempts: string[]
} {
  const started: string[] = []
  const attempts: string[] = []
  let active = 0
  return {
    maxConcurrency: 1,
    maxLiveSessions,
    started,
    attempts,
    countActiveTasks: () => active,
    countLiveSessions: () => live,
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
        waitingReason: null,
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

  it('stops starting when live sessions reach the cap', () => {
    const runtime = queueRuntime(['next'], new Set(), 5, 5)
    createScheduler(runtime).pump()
    expect(runtime.started).toEqual([])
  })

  it('starts while a blocked task is live but no longer holds an execution slot', () => {
    const runtime = queueRuntime(['next'], new Set(), 1, 5)
    createScheduler(runtime).pump()
    expect(runtime.started).toEqual(['next'])
  })
})
