import type { TaskBudgetSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { useState } from 'react'
import { useCommand } from '../../lib/command-context'
import { CommandError } from '../../lib/ws'

export function BudgetEditor({
  taskId,
  budget,
  onDone,
}: {
  taskId: string
  budget: TaskBudgetSummary
  onDone?: () => Promise<void> | void
}) {
  const send = useCommand()
  const [value, setValue] = useState(budget.budgetUsd.toFixed(2))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const next = Number(value)
    if (!Number.isFinite(next) || next <= 0) {
      setError('预算必须是正数')
      return
    }
    setPending(true)
    setError(null)
    try {
      await send({ type: 'task.set_budget', payload: { taskId, budgetUsd: next } })
      await onDone?.()
    } catch (cause) {
      if (cause instanceof CommandError && cause.code === 'budget_below_spent') {
        setError('新预算必须高于已花费')
      } else if (cause instanceof CommandError && cause.code === 'budget_too_large') {
        setError('预算超过服务端上限')
      } else {
        setError(cause instanceof Error ? cause.message : '保存失败')
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="shrink-0 rounded-lg border border-separator bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">任务预算</h3>
        <span className="font-mono text-xs text-muted">
          ${budget.spentUsd.toFixed(2)} / ${budget.budgetUsd.toFixed(2)}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        剩余 ${budget.remainingUsd.toFixed(2)} · {budget.turns} turns
      </p>
      {budget.overBudget ? (
        <p className="mt-1 text-xs text-danger">超预算</p>
      ) : budget.nearBudget ? (
        <p className="mt-1 text-xs text-warning">接近预算</p>
      ) : null}
      <div className="mt-2 flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
          任务预算
          <input
            aria-label="任务预算"
            type="number"
            min="0.01"
            step="0.01"
            className="h-8 rounded-lg border border-separator bg-field px-2 text-sm text-foreground"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <Button variant="primary" isDisabled={pending} onPress={() => void save()}>
          保存预算
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
