import { budgetState } from '@baton/core'
import type { Task, TaskBudgetSummary } from '@baton/protocol'
import { getAcceptanceBundle } from '../db/acceptance-repository.js'
import { getTask, listSessionsByTask, listSessionsByTasks } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import type { Config } from '../config.js'

export type BudgetConfig = Pick<Config, 'claudeMaxBudgetUsd'>

export function getTaskBudgetSummary(
  db: Db,
  task: Pick<Task, 'id' | 'budgetUsd'>,
  config: BudgetConfig,
): TaskBudgetSummary {
  const workerSessions = listSessionsByTask(db, task.id)
  return budgetSummaryFromSessions(db, task, workerSessions, config)
}

export function listTaskBudgetSummaries(
  db: Db,
  tasks: Task[],
  config: BudgetConfig,
): Map<string, TaskBudgetSummary> {
  const sessions = listSessionsByTasks(
    db,
    tasks.map((task) => task.id),
  )
  const byTask = new Map<string, typeof sessions>()
  for (const session of sessions) {
    const list = byTask.get(session.taskId) ?? []
    list.push(session)
    byTask.set(session.taskId, list)
  }
  return new Map(
    tasks.map((task) => [
      task.id,
      budgetSummaryFromSessions(db, task, byTask.get(task.id) ?? [], config),
    ]),
  )
}

function budgetSummaryFromSessions(
  db: Db,
  task: Pick<Task, 'id' | 'budgetUsd'>,
  workerSessions: ReturnType<typeof listSessionsByTask>,
  config: BudgetConfig,
): TaskBudgetSummary {
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
