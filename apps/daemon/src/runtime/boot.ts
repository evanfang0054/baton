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
  applyTransition: (
    taskId: string,
    event: { type: 'error'; message: string } | { type: 'cancel'; reason?: string },
  ) => TransitionOutcome
  now: () => number
  newId: () => string
}

/**
 * 重启后没有存活的子进程：把所有瞬时状态收敛到明确终态，避免僵尸任务。
 * 只使用现有转移事件，不新增协议分支。
 */
export function reconcileOnBoot(deps: BootReconcilerDeps): void {
  const activeSessions = listSessionsByStatus(deps.db, ['running', 'waiting_input'])
  for (const session of activeSessions) {
    deps.db.transaction((tx) => updateSessionStatus(tx, session.id, 'failed', deps.now()))
  }

  for (const task of listTasksByStatus(deps.db, ['running', 'waiting_input'])) {
    deps.applyTransition(task.id, { type: 'error', message: 'daemon restarted' })
  }

  for (const task of listTasksByStatus(deps.db, ['verifying'])) {
    deps.applyTransition(task.id, {
      type: 'cancel',
      reason: 'daemon restarted during verify',
    })
  }

  for (const approval of listPendingApprovals(deps.db)) {
    deps.db.transaction((tx) =>
      updateApprovalDecision(tx, approval.id, 'deny', 'system', deps.now()),
    )
    deps.db.transaction((tx) =>
      insertAudit(tx, {
        id: deps.newId(),
        ts: deps.now(),
        actor: 'system',
        action: 'approval.expired',
        detail: { approvalId: approval.id },
      }),
    )
  }
}
