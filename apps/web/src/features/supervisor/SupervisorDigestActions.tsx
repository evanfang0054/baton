import type { AttentionItem } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { useState } from 'react'
import { WaitingTime } from '../tasks/WaitingTime'

const MAX_VISIBLE = 5

export function SupervisorDigestActions({
  items,
  actionsEnabled = true,
  onOpenTask,
  onApplyProposal,
}: {
  items: AttentionItem[]
  actionsEnabled?: boolean
  onOpenTask?: (taskId: string) => void
  onApplyProposal?: (proposalId: string) => Promise<boolean> | boolean | void
}) {
  const [applied, setApplied] = useState<Set<string>>(() => new Set())
  if (items.length === 0) return null
  const visible = items.slice(0, MAX_VISIBLE)
  const hidden = items.length - visible.length

  const apply = async (proposalId: string) => {
    const result = await onApplyProposal?.(proposalId)
    if (result === false) return
    setApplied((previous) => new Set(previous).add(proposalId))
  }

  return (
    <section
      aria-label={actionsEnabled ? '需要你决定' : '历史汇报中的待决策项'}
      className="flex flex-col gap-1 rounded-lg border border-separator bg-default/30 p-2"
    >
      {visible.map((item) => {
        const action = item.action
        return (
          <div key={item.taskId} className="flex flex-col gap-1 rounded-md px-1 py-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-foreground">{item.title}</span>
              {item.waitingSince !== null ? <WaitingTime since={item.waitingSince} /> : null}
            </div>
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-xs text-muted">{item.reason}</p>
              {!actionsEnabled ? null : action.type === 'apply_proposal' ? (
                applied.has(action.proposalId) ? (
                  <span className="shrink-0 text-xs text-muted">已应用</span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onPress={() => void apply(action.proposalId)}
                  >
                    应用建议
                  </Button>
                )
              ) : (
                <Button variant="tertiary" size="sm" onPress={() => onOpenTask?.(item.taskId)}>
                  {action.type === 'open_review' ? '去验收' : '打开任务'}
                </Button>
              )}
            </div>
          </div>
        )
      })}
      {hidden > 0 ? (
        <p className="px-1 text-xs text-muted">其余 {hidden} 件到任务详情处理。</p>
      ) : null}
    </section>
  )
}
