import { budgetState } from '@baton/core'
import type { Task, TaskBudgetSummary } from '@baton/protocol'
import { getAcceptanceBundle } from '../db/acceptance-repository.js'
import { listSessionsByTask } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import type { Config } from '../config.js'

export function getTaskBudgetSummary(
  db: Db,
  task: Pick<Task, 'id' | 'budgetUsd'>,
  config: Pick<Config, 'claudeMaxBudgetUsd'>,
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
