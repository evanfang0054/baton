import type { TaskBudgetSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { useState } from 'react'
import { useCommand } from '../../lib/command-context'
import { CommandError } from '../../lib/ws'

export function BudgetCard({
  taskId,
  budget,
  onDone,
}: {
  taskId: string
  budget: TaskBudgetSummary
  onDone: () => Promise<void> | void
}) {
  const send = useCommand()
  const [value, setValue] = useState(budget.budgetUsd.toFixed(2))
  const [pending, setPending] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const raise = async () => {
    const next = Number(value)
    if (!Number.isFinite(next) || next <= budget.spentUsd) {
      setError('新预算必须高于已花费')
      return
    }
    setPending(true)
    setError(null)
    try {
      await send({ type: 'task.set_budget', payload: { taskId, budgetUsd: next } })
      await onDone()
    } catch (cause) {
      if (cause instanceof CommandError && cause.code === 'budget_below_spent') {
        setError('新预算必须高于已花费')
      } else if (cause instanceof CommandError && cause.code === 'budget_too_large') {
        setError('预算超过服务端上限')
      } else {
        setError(cause instanceof Error ? cause.message : '提额失败')
      }
    } finally {
      setPending(false)
    }
  }

  const cancel = async () => {
    setPending(true)
    setError(null)
    try {
      await send({ type: 'task.cancel', payload: { taskId } })
      await onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '取消失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="shrink-0 rounded-lg border border-warning border-l-2 bg-background p-3">
      <h3 className="text-sm font-medium text-warning">预算已用完</h3>
      <p className="mt-1 font-mono text-xs text-muted">
        ${budget.spentUsd.toFixed(2)} / ${budget.budgetUsd.toFixed(2)} · 剩余 $
        {budget.remainingUsd.toFixed(2)}
      </p>
      <p className="mt-1 text-xs text-muted">
        任务停在预算上限处。提高预算会开新一轮 session，从当前工作区状态继续。
      </p>
      <div className="mt-2 flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
          新预算
          <input
            aria-label="新预算"
            type="number"
            min="0.01"
            step="0.01"
            className="h-8 rounded-lg border border-separator bg-field px-2 text-sm text-foreground"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <Button variant="primary" isDisabled={pending} onPress={() => void raise()}>
          提额并继续
        </Button>
      </div>
      {confirmingCancel ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-sm text-warning">确认取消这个任务？</p>
          <div className="flex gap-2">
            <Button variant="tertiary" onPress={() => setConfirmingCancel(false)}>
              返回
            </Button>
            <Button variant="danger" isDisabled={pending} onPress={() => void cancel()}>
              确认取消
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex justify-end">
          <Button variant="tertiary" onPress={() => setConfirmingCancel(true)}>
            取消任务
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
