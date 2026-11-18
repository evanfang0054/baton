import type { TaskTransitionEvent } from '@baton/protocol'
import type { TransitionOutcome } from './types.js'

export interface SchedulerRuntime {
  readonly maxConcurrency: number
  readonly maxLiveSessions: number
  countActiveTasks(): number
  countLiveSessions(): number
  findNextQueued(exclude?: ReadonlySet<string>): { id: string } | null
  applyTransition(taskId: string, event: TaskTransitionEvent): TransitionOutcome
}

/**
 * 单写者调度器：每次只启动最早入队的任务，直到占用槽达到上限。
 * 状态机负责 start 守卫；这里只负责找下一个候选。
 */
export function createScheduler(runtime: SchedulerRuntime) {
  let pumping = false

  function pump(): void {
    if (pumping) {
      return
    }
    pumping = true
    try {
      const skipped = new Set<string>()
      while (true) {
        if (runtime.countActiveTasks() >= runtime.maxConcurrency) {
          break
        }
        // 阻塞任务不占执行槽，但它的引擎进程仍然存活；单独限制总量避免宿主被耗尽。
        if (runtime.countLiveSessions() >= runtime.maxLiveSessions) {
          break
        }
        const next = runtime.findNextQueued(skipped)
        if (!next) {
          break
        }
        const outcome = runtime.applyTransition(next.id, { type: 'start' })
        if (!outcome.ok) {
          // 单条坏任务（workspace 被删、policy 非法）不能永久占住队首。
          skipped.add(next.id)
        }
      }
    } finally {
      pumping = false
    }
  }

  return { pump, kick: pump }
}

export type Scheduler = ReturnType<typeof createScheduler>
