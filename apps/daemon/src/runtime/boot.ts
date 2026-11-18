import type { TaskTransitionEvent } from '@baton/protocol'
import type { Logger } from '../log.js'
import type { Db } from '../db/types.js'
import {
  insertAudit,
  listPendingApprovals,
  listSessionsByStatus,
  listTasksByStatus,
  updateApprovalDecision,
  updateSessionStatus,
} from '../db/repositories.js'
import type { TransitionOutcome } from './types.js'

export interface BootReconcilerDeps {
  db: Db
  applyTransition: (taskId: string, event: TaskTransitionEvent) => TransitionOutcome
  now: () => number
  newId: () => string
  logger?: Logger
}

/**
 * 重启后没有存活的子进程：把瞬时状态收敛到可恢复的等待态，避免僵尸任务。
 * 任务保留为 waiting_input(stalled)，用户可重新入队或取消；不回放历史。
 */
export function reconcileOnBoot(deps: BootReconcilerDeps): void {
  const apply = (taskId: string, event: TaskTransitionEvent): void => {
    const outcome = deps.applyTransition(taskId, event)
    if (!outcome.ok) {
      deps.logger?.error(
        { action: 'boot.reconcile', taskId, code: outcome.error.code },
        'boot reconcile failed',
      )
    }
  }

  const activeSessions = listSessionsByStatus(deps.db, ['running', 'waiting_input'])
  for (const session of activeSessions) {
    deps.db.transaction((tx) => updateSessionStatus(tx, session.id, 'failed', deps.now()))
  }

  for (const task of listTasksByStatus(deps.db, ['running', 'waiting_input'])) {
    apply(task.id, { type: 'session_reported', outcome: 'unreported', reason: 'daemon restarted' })
  }

  for (const task of listTasksByStatus(deps.db, ['verifying'])) {
    apply(task.id, {
      type: 'verify_fail',
      reviewId: deps.newId(),
      exitCode: 124,
      output: 'daemon restarted during verify',
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    })
  }

  for (const approval of listPendingApprovals(deps.db)) {
    deps.db.transaction((tx) => {
      updateApprovalDecision(tx, approval.id, 'deny', 'system', deps.now())
      insertAudit(tx, {
        id: deps.newId(),
        ts: deps.now(),
        actor: 'system',
        action: 'approval.expired',
        detail: { approvalId: approval.id },
      })
    })
  }
}
