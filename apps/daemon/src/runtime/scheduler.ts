import type { TaskTransitionEvent } from '@baton/protocol'
import type { TransitionOutcome } from './types.js'

export interface SchedulerRuntime {
  readonly maxConcurrency: number
  countActiveTasks(): number
  findNextQueued(): { id: string } | null
  applyTransition(taskId: string, event: TaskTransitionEvent): TransitionOutcome
}

/**
 * 单写者调度器：每次只启动最早入队的任务，直到占用槽达到上限。
 * 状态机负责 start 守卫；这里只负责找下一个候选。
 */
export function createScheduler(runtime: SchedulerRuntime) {
  let pumping = false

  function pump(): void {
    if (pumping) return
    pumping = true
    try {
      while (true) {
        if (runtime.countActiveTasks() >= runtime.maxConcurrency) break
        const next = runtime.findNextQueued()
        if (!next) break
        const outcome = runtime.applyTransition(next.id, { type: 'start' })
        if (!outcome.ok) break
      }
    } finally {
      pumping = false
    }
  }

  return { pump, kick: pump }
}

export type Scheduler = ReturnType<typeof createScheduler>
