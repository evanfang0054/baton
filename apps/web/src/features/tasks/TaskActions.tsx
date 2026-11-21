import type { Attention, TaskBudgetSummary, TaskStatus, WaitingReason } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { TextArea } from '@heroui/react/textarea'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { queryKeys } from '../../lib/query'
import { BudgetCard } from './BudgetCard'
import { useCommandAction } from './useCommandAction'

export function TaskActions({
  taskId,
  workspaceId,
  status,
  attention,
  waitingReason = null,
  budget = null,
  sticky = false,
}: {
  taskId: string
  workspaceId: string
  status: TaskStatus
  attention: Attention
  waitingReason?: WaitingReason | null
  budget?: TaskBudgetSummary | null
  sticky?: boolean
}) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) })
    await queryClient.invalidateQueries({ queryKey: queryKeys.taskHistory(taskId) })
    await queryClient.invalidateQueries({ queryKey: queryKeys.tasks(workspaceId) })
    setConfirming(false)
  }
  const action = useCommandAction(refresh)
  const sectionClass = sticky
    ? 'sticky bottom-0 z-10 shrink-0 rounded-lg border border-separator bg-background p-3 shadow-overlay'
    : 'shrink-0 rounded-lg border border-separator bg-background p-3'
  const waitingClass = sticky
    ? 'sticky bottom-0 z-10 shrink-0 rounded-lg border border-warning border-l-2 bg-background p-3 shadow-overlay'
    : 'shrink-0 rounded-lg border border-warning border-l-2 bg-background p-3'

  if (status === 'waiting_input') {
    if (waitingReason === 'budget' && budget) {
      return <BudgetCard taskId={taskId} budget={budget} onDone={refresh} />
    }
    if (attention !== 'needs_attention') return null
    return (
      <section className={waitingClass}>
        {confirming ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-warning">确认取消这个任务？</p>
            <div className="flex gap-2">
              <Button variant="tertiary" onPress={() => setConfirming(false)}>
                返回
              </Button>
              <Button
                variant="danger"
                isDisabled={action.pending}
                onPress={() => action.run({ type: 'task.cancel', payload: { taskId } })}
              >
                确认取消
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-warning">
              任务已停滞：会话丢失或 daemon 重启。重新入队会创建新会话。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="tertiary" onPress={() => setConfirming(true)}>
                取消任务
              </Button>
              <Button
                variant="primary"
                isDisabled={action.pending}
                onPress={() => action.run({ type: 'task.enqueue', payload: { taskId } })}
              >
                重新入队
              </Button>
            </div>
          </div>
        )}
        {action.error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {action.error}
          </p>
        ) : null}
      </section>
    )
  }

  if (status === 'failed' || status === 'done' || status === 'cancelled') {
    const retry = status === 'failed'
    const label = retry ? '重试' : '重新打开'
    const noteLabel = retry ? '重试备注' : '重开备注'
    const payload = {
      taskId,
      ...(note.trim() ? { note: note.trim() } : {}),
    }
    return (
      <section className={sectionClass}>
        {confirming ? (
          <div className="flex flex-col gap-2">
            <TextArea
              aria-label={noteLabel}
              placeholder="可选：说明这次要继续做什么"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              fullWidth
            />
            <div className="flex justify-end gap-2">
              <Button variant="tertiary" onPress={() => setConfirming(false)}>
                返回
              </Button>
              <Button
                variant="primary"
                isDisabled={action.pending}
                onPress={() =>
                  action.run(
                    retry ? { type: 'task.retry', payload } : { type: 'task.reopen', payload },
                  )
                }
              >
                确认{label}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {retry ? '任务失败，可以重试。' : '任务已结束，可以重新打开继续处理。'}
            </p>
            <Button variant={retry ? 'primary' : 'tertiary'} onPress={() => setConfirming(true)}>
              {label}
            </Button>
          </div>
        )}
        {action.error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {action.error}
          </p>
        ) : null}
      </section>
    )
  }

  if (status !== 'todo' && status !== 'queued' && status !== 'running') {
    return null
  }

  return (
    <section className={sectionClass}>
      {status === 'todo' ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">任务已创建，尚未开工。</p>
          <Button
            variant="primary"
            isDisabled={action.pending}
            onPress={() => action.run({ type: 'task.enqueue', payload: { taskId } })}
          >
            立即开工
          </Button>
        </div>
      ) : confirming ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-warning">确认取消这个任务？</p>
          <div className="flex gap-2">
            <Button variant="tertiary" onPress={() => setConfirming(false)}>
              返回
            </Button>
            <Button
              variant="danger"
              isDisabled={action.pending}
              onPress={() => action.run({ type: 'task.cancel', payload: { taskId } })}
            >
              确认取消
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">任务正在执行。</p>
          <Button variant="danger-soft" onPress={() => setConfirming(true)}>
            取消任务
          </Button>
        </div>
      )}
      {action.error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {action.error}
        </p>
      ) : null}
    </section>
  )
}
