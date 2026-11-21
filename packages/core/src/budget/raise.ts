import type { TaskStatus, WaitingReason } from '@baton/protocol'

export interface CanRaiseBudgetInput {
  status: TaskStatus
  waitingReason: WaitingReason | null
  spentUsd: number
  nextBudgetUsd: number
  maxBudgetUsd: number
}

export type BudgetRaiseValidation =
  | { ok: true }
  | {
      ok: false
      code: 'invalid_state' | 'invalid_budget' | 'budget_too_large' | 'budget_below_spent'
      message: string
    }

export function canRaiseBudget(input: CanRaiseBudgetInput): BudgetRaiseValidation {
  if (input.status !== 'waiting_input' || input.waitingReason !== 'budget') {
    return { ok: false, code: 'invalid_state', message: '只有预算超限的任务可以提额' }
  }
  if (!Number.isFinite(input.nextBudgetUsd) || input.nextBudgetUsd <= 0) {
    return { ok: false, code: 'invalid_budget', message: '预算必须是大于 0 的数字' }
  }
  if (input.nextBudgetUsd > input.maxBudgetUsd) {
    return {
      ok: false,
      code: 'budget_too_large',
      message: `单任务预算不能超过 $${input.maxBudgetUsd}`,
    }
  }
  if (input.nextBudgetUsd <= input.spentUsd) {
    return {
      ok: false,
      code: 'budget_below_spent',
      message: '新预算必须高于已花费金额',
    }
  }
  return { ok: true }
}
