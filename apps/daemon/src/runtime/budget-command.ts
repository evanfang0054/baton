import type { AppError, TaskSetBudgetInput, TaskTransitionEvent } from '@baton/protocol'
import type { Config } from '../config.js'
import { getTaskBudgetSummary } from '../budget/service.js'
import { getTask, insertAudit, listAudit, updateTaskBudget } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import type { TransitionOutcome } from './types.js'

const ALLOWED_STATUSES = new Set(['todo', 'queued', 'waiting_input', 'failed'])

export interface BudgetCommandDeps {
  db: Db
  config: Pick<Config, 'claudeMaxBudgetUsd' | 'maxTaskBudgetUsd'>
  applyTransition: (taskId: string, event: TaskTransitionEvent) => TransitionOutcome
  now: () => number
  newId: () => string
}

export type TaskSetBudgetResult =
  | { ok: true; ack: { taskId: string; budgetUsd: number; status: string } }
  | { ok: false; error: AppError }

export function handleTaskSetBudget(
  deps: BudgetCommandDeps,
  input: TaskSetBudgetInput,
): TaskSetBudgetResult {
  const task = getTask(deps.db, input.taskId)
  if (!task) {
    return {
      ok: false,
      error: appError('task_not_found', 'task not found', { taskId: input.taskId }),
    }
  }
  if (!ALLOWED_STATUSES.has(task.status)) {
    return {
      ok: false,
      error: appError('invalid_state', 'task cannot change budget in its current state', {
        taskId: task.id,
        status: task.status,
      }),
    }
  }
  if (!Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0) {
    return { ok: false, error: appError('invalid_payload', 'budget must be a positive number') }
  }
  if (input.budgetUsd > deps.config.maxTaskBudgetUsd) {
    return {
      ok: false,
      error: appError('budget_too_large', 'task budget exceeds the configured maximum', {
        budgetUsd: input.budgetUsd,
        maxTaskBudgetUsd: deps.config.maxTaskBudgetUsd,
      }),
    }
  }

  const budget = getTaskBudgetSummary(deps.db, task, deps.config)
  const resuming = task.status === 'waiting_input' && task.waitingReason === 'budget'
  if (resuming && input.budgetUsd <= budget.spentUsd) {
    return {
      ok: false,
      error: appError('budget_below_spent', 'budget must exceed the amount already spent', {
        taskId: task.id,
        budgetUsd: input.budgetUsd,
        spentUsd: budget.spentUsd,
      }),
    }
  }

  const at = deps.now()
  deps.db.transaction((tx) => {
    updateTaskBudget(tx, task.id, input.budgetUsd, at)
    insertAudit(tx, {
      id: deps.newId(),
      ts: at,
      actor: 'human',
      action: resuming ? 'task.budget.raise' : 'task.budget.set',
      detail: {
        taskId: task.id,
        oldBudgetUsd: task.budgetUsd ?? deps.config.claudeMaxBudgetUsd,
        newBudgetUsd: input.budgetUsd,
        spentUsd: budget.spentUsd,
      },
    })
  })

  if (!resuming) {
    return { ok: true, ack: { taskId: task.id, budgetUsd: input.budgetUsd, status: task.status } }
  }
  const outcome = deps.applyTransition(task.id, {
    type: 'budget_raise',
    budgetUsd: input.budgetUsd,
  })
  if (!outcome.ok) return outcome
  return {
    ok: true,
    ack: { taskId: task.id, budgetUsd: input.budgetUsd, status: outcome.status },
  }
}

export interface BudgetResumeNote {
  previousUsd: number
  budgetUsd: number
}

/**
 * 提额后新 run 需要补一段恢复提示；用审计时间比较，避免重复注入。
 * 不把这段提示写回 task.prompt，保持任务原文可追溯。
 */
export function pendingBudgetResume(db: Db, taskId: string): BudgetResumeNote | null {
  const audits = listAudit(db, { actionPrefix: 'task.budget.', limit: 200 })
  const raise = audits.find(
    (entry) =>
      entry.action === 'task.budget.raise' &&
      (entry.detail as { taskId?: string }).taskId === taskId,
  )
  if (!raise) return null
  const resume = audits.find(
    (entry) =>
      entry.action === 'task.budget.resume' &&
      (entry.detail as { taskId?: string }).taskId === taskId,
  )
  if (resume && resume.ts >= raise.ts) return null
  const detail = raise.detail as { oldBudgetUsd?: number; newBudgetUsd?: number }
  return {
    previousUsd: detail.oldBudgetUsd ?? 0,
    budgetUsd: detail.newBudgetUsd ?? 0,
  }
}

export function formatBudgetResume(note: BudgetResumeNote): string {
  return `<budget_resume previous_usd="${note.previousUsd.toFixed(2)}" budget_usd="${note.budgetUsd.toFixed(2)}">\n上一轮在预算上限处停止。预算已提高；请从当前工作区状态继续，不要重复已完成的工作。\n</budget_resume>`
}
