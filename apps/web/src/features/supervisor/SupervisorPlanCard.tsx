import { templateById } from '@baton/core'
import type { PlanApplyResult, PlanPayload, SupervisorActionStatus } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getSupervisorAction } from '../../lib/api'
import { useCommand } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { useAppStore } from '../../stores/app'

export function SupervisorPlanCard({
  actionId,
  plan,
  initialStatus,
}: {
  actionId: string
  plan: PlanPayload
  initialStatus: SupervisorActionStatus
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId)
  const [error, setError] = useState<string | null>(null)
  const action = useQuery({
    queryKey: queryKeys.supervisorAction(actionId),
    queryFn: () => getSupervisorAction(actionId),
  })
  const status = action.data?.action.status ?? initialStatus
  const result = action.data?.action.result as PlanApplyResult | null | undefined
  const template = templateById(plan.templateId)

  async function decide(decision: 'apply' | 'ignore') {
    if (!activeWorkspaceId) return
    setError(null)
    try {
      await send({
        type: 'supervisor.action.decide',
        payload: { workspaceId: activeWorkspaceId, actionId, decision },
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.supervisorAction(actionId) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败')
    }
  }

  if (status === 'expired') return <p className="text-xs text-danger">计划已过期</p>
  if (status === 'ignored') return <p className="text-xs text-muted">计划已忽略</p>
  if (status === 'failed') return <p className="text-xs text-danger">计划应用失败</p>

  return (
    <section
      aria-label="计划预览"
      className="flex flex-col gap-2 rounded-lg border border-separator bg-background p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">计划：{plan.items.length} 个任务</h3>
        {template ? (
          <Chip size="sm" variant="soft" color="accent">
            {template.label}
          </Chip>
        ) : null}
      </div>
      <p className="text-xs text-muted">上下文摘要 {plan.contextDigest.length} 条</p>
      <ul className="flex flex-col gap-1">
        {plan.items.map((item, index) => (
          <li
            key={`${item.title}-${index}`}
            className="flex flex-col gap-0.5 rounded-md bg-default p-2"
          >
            <span className="text-xs text-foreground">{item.title}</span>
            <span className="text-xs text-muted">上下文 {item.contextNodeIds.length} 个</span>
          </li>
        ))}
      </ul>
      {template ? (
        <div className="text-xs text-muted">
          <p>验收建议</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {template.acceptanceSeed.slice(0, 3).map((seed) => (
              <li key={seed}>- {seed}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result ? (
        <div className="flex flex-col gap-0.5 text-xs text-muted">
          <p>
            已创建 {result.createdTaskIds.length} 个；失败 {result.failed.length} 个
          </p>
          {result.failed.map((failure) => (
            <p key={`${failure.index}-${failure.code}`} className="text-danger">
              第 {failure.index + 1} 条：{failure.message}
            </p>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {status === 'proposed' ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="primary" size="sm" onPress={() => void decide('apply')}>
            应用全部
          </Button>
          <Button variant="tertiary" size="sm" onPress={() => void decide('ignore')}>
            忽略
          </Button>
        </div>
      ) : null}
    </section>
  )
}
