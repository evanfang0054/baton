import { isHandoffable, type TaskStatus } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { toast } from '@heroui/react/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useCommand } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'

export function HandoffButton({
  taskId,
  workspaceId,
  status,
}: {
  taskId: string
  workspaceId: string
  status: TaskStatus
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  if (!isHandoffable(status)) return null

  const run = async () => {
    setPending(true)
    try {
      const ack = (await send({
        type: 'task.handoff',
        payload: { taskId, workspaceId },
      })) as { warnings?: string[] } | null
      await queryClient.invalidateQueries({ queryKey: queryKeys.canvas(workspaceId) })
      toast.success('已生成交接节点，可在画布中选中它创建下一个任务')
      for (const warning of ack?.warnings ?? []) toast.info(warning)
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '生成交接节点失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-separator bg-background p-3">
      <p className="text-sm text-muted">把这次结果做成交接节点，交给下一个任务。</p>
      <Button variant="tertiary" size="sm" isDisabled={pending} onPress={run}>
        生成交接节点
      </Button>
    </section>
  )
}
