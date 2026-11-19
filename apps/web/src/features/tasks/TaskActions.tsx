import type { Attention, TaskStatus } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { queryKeys } from '../../lib/query'
import { useCommandAction } from './useCommandAction'

export function TaskActions({
  taskId,
  workspaceId,
  status,
  attention,
  sticky = false,
}: {
  taskId: string
  workspaceId: string
  status: TaskStatus
  attention: Attention
  sticky?: boolean
}) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const action = useCommandAction(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) })
    await queryClient.invalidateQueries({ queryKey: queryKeys.tasks(workspaceId) })
    setConfirming(false)
  })
  const sectionClass = sticky
    ? 'sticky bottom-0 z-10 shrink-0 rounded-lg border border-separator bg-background p-3 shadow-overlay'
    : 'shrink-0 rounded-lg border border-separator bg-background p-3'
  const waitingClass = sticky
    ? 'sticky bottom-0 z-10 shrink-0 rounded-lg border border-warning border-l-2 bg-background p-3 shadow-overlay'
    : 'shrink-0 rounded-lg border border-warning border-l-2 bg-background p-3'

  if (status === 'waiting_input') {
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
