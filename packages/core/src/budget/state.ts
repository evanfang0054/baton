import type { TaskBudgetSummary } from '@baton/protocol'

export interface BudgetStateInput {
  budgetUsd: number
  workerCostUsd: number | null
  verifierCostUsd: number | null
  turns: number | null
}

export function budgetState(input: BudgetStateInput): TaskBudgetSummary {
  const budgetUsd = round(Math.max(0, input.budgetUsd))
  const workerCostUsd = round(Math.max(0, input.workerCostUsd ?? 0))
  const verifierCostUsd = round(Math.max(0, input.verifierCostUsd ?? 0))
  const spentUsd = workerCostUsd
  const remainingUsd = round(Math.max(0, budgetUsd - spentUsd))
  const ratio = budgetUsd <= 0 ? 0 : round(spentUsd / budgetUsd)
  const overBudget = spentUsd >= budgetUsd
  const nearBudget = !overBudget && ratio >= 0.8
  return {
    budgetUsd,
    spentUsd,
    remainingUsd,
    ratio,
    overBudget,
    nearBudget,
    workerCostUsd,
    verifierCostUsd,
    turns: Math.max(0, input.turns ?? 0),
  }
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}
