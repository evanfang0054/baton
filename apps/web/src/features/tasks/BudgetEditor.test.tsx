import type { TaskBudgetSummary } from '@baton/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { BudgetEditor } from './BudgetEditor'

const budget: TaskBudgetSummary = {
  budgetUsd: 2,
  spentUsd: 1,
  remainingUsd: 1,
  ratio: 0.5,
  overBudget: false,
  nearBudget: false,
  workerCostUsd: 1,
  verifierCostUsd: 0,
  turns: 2,
}

describe('BudgetEditor', () => {
  it('saves a new budget and shows the spent summary', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const onDone = vi.fn()
    render(
      <CommandProvider send={send}>
        <BudgetEditor taskId="t1" budget={budget} onDone={onDone} />
      </CommandProvider>,
    )
    expect(screen.getByText('$1.00 / $2.00')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('任务预算'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '保存预算' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'task.set_budget',
        payload: { taskId: 't1', budgetUsd: 3 },
      }),
    )
    expect(onDone).toHaveBeenCalled()
  })
})
