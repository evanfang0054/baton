import { describe, expect, it } from 'vitest'
import { budgetState, canRaiseBudget } from '../src/index.js'

describe('budgetState', () => {
  it('marks normal, near and over budget', () => {
    expect(
      budgetState({ budgetUsd: 2, workerCostUsd: 1, verifierCostUsd: 0.1, turns: 2 }),
    ).toMatchObject({ nearBudget: false, overBudget: false, remainingUsd: 1 })
    expect(
      budgetState({ budgetUsd: 2, workerCostUsd: 1.7, verifierCostUsd: 0.1, turns: 3 }),
    ).toMatchObject({ nearBudget: true, overBudget: false, remainingUsd: 0.3 })
    expect(
      budgetState({ budgetUsd: 2, workerCostUsd: 2.1, verifierCostUsd: 0, turns: 3 }),
    ).toMatchObject({ nearBudget: false, overBudget: true, remainingUsd: 0 })
  })

  it('keeps verifier cost separate and treats null as zero', () => {
    const state = budgetState({
      budgetUsd: 2,
      workerCostUsd: null,
      verifierCostUsd: 0.08,
      turns: null,
    })
    expect(state).toMatchObject({
      spentUsd: 0,
      workerCostUsd: 0,
      verifierCostUsd: 0.08,
      turns: 0,
    })
  })

  it('marks zero budget as over', () => {
    expect(
      budgetState({ budgetUsd: 0, workerCostUsd: 0, verifierCostUsd: 0, turns: 0 }),
    ).toMatchObject({ overBudget: true, ratio: 0, remainingUsd: 0 })
  })
})

describe('canRaiseBudget', () => {
  const base = {
    status: 'waiting_input' as const,
    waitingReason: 'budget' as const,
    spentUsd: 2,
    nextBudgetUsd: 3,
    maxBudgetUsd: 50,
  }

  it('accepts a higher budget in waiting_input(budget)', () => {
    expect(canRaiseBudget(base)).toEqual({ ok: true })
  })

  it('rejects other states and reasons', () => {
    expect(canRaiseBudget({ ...base, status: 'running' })).toMatchObject({
      ok: false,
      code: 'invalid_state',
    })
    expect(canRaiseBudget({ ...base, waitingReason: 'approval' })).toMatchObject({
      ok: false,
      code: 'invalid_state',
    })
  })

  it('rejects non-positive, below-spent and too-large budgets', () => {
    expect(canRaiseBudget({ ...base, nextBudgetUsd: 0 })).toMatchObject({
      ok: false,
      code: 'invalid_budget',
    })
    expect(canRaiseBudget({ ...base, nextBudgetUsd: 2 })).toMatchObject({
      ok: false,
      code: 'budget_below_spent',
    })
    expect(canRaiseBudget({ ...base, nextBudgetUsd: 51 })).toMatchObject({
      ok: false,
      code: 'budget_too_large',
    })
  })
})
