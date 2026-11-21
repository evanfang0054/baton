import { budgetState } from '@baton/core'
import type { Task, TaskBudgetSummary } from '@baton/protocol'
import { getAcceptanceBundle } from '../db/acceptance-repository.js'
import { getTask, listSessionsByTask } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import type { Config } from '../config.js'

export type BudgetConfig = Pick<Config, 'claudeMaxBudgetUsd'>

export function getTaskBudgetSummary(
  db: Db,
  task: Pick<Task, 'id' | 'budgetUsd'>,
  config: BudgetConfig,
): TaskBudgetSummary {
  const workerSessions = listSessionsByTask(db, task.id)
  const workerCostUsd = sumCost(workerSessions)
  const turns = workerSessions.reduce((total, session) => total + (session.turns ?? 0), 0)
  const run = getAcceptanceBundle(db, task.id)?.run
  const verifierSessions = run?.verifierTaskId ? listSessionsByTask(db, run.verifierTaskId) : []
  return budgetState({
    budgetUsd: task.budgetUsd ?? config.claudeMaxBudgetUsd,
    workerCostUsd,
    verifierCostUsd: sumCost(verifierSessions),
    turns,
  })
}

function sumCost(sessions: ReadonlyArray<{ costUsd: number | null }>): number {
  return sessions.reduce((total, session) => total + (session.costUsd ?? 0), 0)
}

export function getTaskBudgetState(
  db: Db,
  taskId: string,
  config: BudgetConfig,
): TaskBudgetSummary | null {
  const task = getTask(db, taskId)
  return task ? getTaskBudgetSummary(db, task, config) : null
}

export function getRemainingBudget(db: Db, taskId: string, config: BudgetConfig): number | null {
  return getTaskBudgetState(db, taskId, config)?.remainingUsd ?? null
}
