import type { DeliveryDetail } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { toast } from '@heroui/react/toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getTask, getTaskAcceptance } from '../../lib/api'
import { useCommand } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { needsAcceptanceOverride } from '../tasks/acceptance-gate'
import { Overlay } from './Overlay'

export function AcceptanceMatrixOverlay({
  delivery,
  onClose,
}: {
  delivery: DeliveryDetail
  onClose: () => void
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const acceptanceStage = delivery.stages.find((stage) => stage.key === 'acceptance')
  const taskId = acceptanceStage?.taskId ?? null
  const task = useQuery({
    queryKey: queryKeys.task(taskId ?? ''),
    queryFn: () => getTask(taskId!),
    enabled: Boolean(taskId),
  })
  const acceptance = useQuery({
    queryKey: queryKeys.taskAcceptance(taskId ?? ''),
    queryFn: () => getTaskAcceptance(taskId!),
    enabled: Boolean(taskId),
  })
  const review = task.data?.review ?? null
  const items = acceptance.data?.items ?? []
  const summary = acceptance.data?.report.acceptance ?? null

  const decide = async (decision: 'approve' | 'reject') => {
    if (!review) return
    // 与任务详情的验收卡保持一致：verify 未过、AC 缺失/未过/待验时，通过必须写理由。
    const needsOverride = needsAcceptanceOverride(review, summary)
    const overridePrompt =
      summary && summary.counts.total === 0
        ? '还没有验收项，仍要直接通过吗？'
        : summary && summary.counts.fail > 0
          ? '仍有验收项未通过，仍要通过吗？'
          : summary && summary.counts.pending > 0
            ? '还有验收项待验证，仍要通过吗？'
            : '校验未通过，仍要通过吗？'
    const overrideReason =
      decision === 'approve' && needsOverride ? window.prompt(overridePrompt)?.trim() : undefined
    if (decision === 'approve' && needsOverride && !overrideReason) return
    try {
      await send({
        type: 'review.decide',
        payload:
          decision === 'approve'
            ? {
                reviewId: review.id,
                decision: 'approve',
                ...(overrideReason ? { overrideReason } : {}),
              }
            : { reviewId: review.id, decision: 'reject', feedback: '验收矩阵未通过' },
      })
      if (taskId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) })
        await queryClient.invalidateQueries({ queryKey: queryKeys.taskAcceptance(taskId) })
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.delivery(delivery.id) })
      toast.success(decision === 'approve' ? '已通过验收阶段' : '已打回验收阶段')
      onClose()
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '验收决策失败')
    }
  }

  return (
    <Overlay title="验收矩阵" onClose={onClose} width="min(1100px, 96vw)">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>需求：{delivery.title}</span>
        <span>阶段：{acceptanceStage?.status ?? '未开始'}</span>
        {review ? <span>review：{review.verdict ?? '待决定'}</span> : null}
        {review && taskId ? (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="primary" onPress={() => void decide('approve')}>
              通过阶段
            </Button>
            <Button size="sm" variant="danger" onPress={() => void decide('reject')}>
              打回
            </Button>
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <section className="rounded-lg border border-separator bg-surface p-3">
          <h3 className="text-xs font-medium text-muted">用户故事</h3>
          <p className="mt-2 text-sm text-foreground">{delivery.goal}</p>
          <ul className="mt-2 list-disc pl-4 text-xs text-muted">
            {delivery.playbook.stages
              .find((stage) => stage.key === 'acceptance')
              ?.acceptance.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
          </ul>
        </section>
        <section className="rounded-lg border border-separator bg-surface p-3">
          <h3 className="text-xs font-medium text-muted">验收标准</h3>
          {items.length === 0 ? (
            <p className="mt-2 text-xs text-muted">还没有 AC 条目；验收阶段任务开始后会生成。</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {items.map((item) => (
                <li key={item.id} className="rounded border border-separator p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{item.text}</span>
                    <span className="ml-auto text-muted">{item.status}</span>
                  </div>
                  {item.evidence ? (
                    <p className="mt-1 truncate font-mono text-[11px] text-muted">
                      {item.evidence}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-lg border border-separator bg-surface p-3">
          <h3 className="text-xs font-medium text-muted">怎么验</h3>
          <ul className="mt-2 flex flex-col gap-2 text-xs text-muted">
            <li>命令：{task.data?.task.verifyCommand ?? '未配置'}</li>
            <li>
              产物：{delivery.artifacts.length} 个（
              {delivery.artifacts.filter((item) => item.status === 'accepted').length} 已接受）
            </li>
            <li>人工：通过阶段按钮由老板拍板</li>
            <li>截图：标注与验收报告可在画布查看</li>
          </ul>
        </section>
      </div>
    </Overlay>
  )
}
