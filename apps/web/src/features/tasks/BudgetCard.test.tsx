import type { TaskBudgetSummary } from '@baton/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { BudgetCard } from './BudgetCard'

const budget: TaskBudgetSummary = {
  budgetUsd: 2,
  spentUsd: 2,
  remainingUsd: 0,
  ratio: 1,
  overBudget: true,
  nearBudget: false,
  workerCostUsd: 2,
  verifierCostUsd: 0,
  turns: 3,
}

describe('BudgetCard', () => {
  it('raises the budget and continues', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const onDone = vi.fn()
    render(
      <CommandProvider send={send}>
        <BudgetCard taskId="t1" budget={budget} onDone={onDone} />
      </CommandProvider>,
    )
    fireEvent.change(screen.getByLabelText('新预算'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '提额并继续' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'task.set_budget',
        payload: { taskId: 't1', budgetUsd: 3 },
      }),
    )
    expect(onDone).toHaveBeenCalled()
  })

  it('rejects a budget below the amount spent', () => {
    const send = vi.fn()
    render(
      <CommandProvider send={send}>
        <BudgetCard taskId="t1" budget={budget} onDone={vi.fn()} />
      </CommandProvider>,
    )
    fireEvent.change(screen.getByLabelText('新预算'), { target: { value: '1.5' } })
    fireEvent.click(screen.getByRole('button', { name: '提额并继续' }))
    expect(screen.getByText('新预算必须高于已花费')).toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()
  })
})
