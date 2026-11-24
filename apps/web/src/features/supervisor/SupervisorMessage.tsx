import type { SupervisorMessage as SupervisorMessageRecord, ToolCallRecord } from '@baton/protocol'
import {
  PlanToolResult,
  SupervisorHandoffResult,
  SupervisorTaskCard as SupervisorTaskCardSchema,
} from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { AlertTriangle } from 'lucide-react'
import { SupervisorDigestActions } from './SupervisorDigestActions'
import { SupervisorPlanCard } from './SupervisorPlanCard'
import { SupervisorTaskCard } from './SupervisorTaskCard'
import { SupervisorToolCard, type SupervisorToolView } from './SupervisorToolCard'
import { toPlainText } from './supervisor-model'

const roleLabels: Record<SupervisorMessageRecord['role'], string> = {
  user: '你',
  assistant: '总管',
}

function toToolView(call: ToolCallRecord): SupervisorToolView {
  return {
    id: call.id,
    name: call.name,
    phase: 'end',
    ok: call.ok,
    args: call.args,
    result: call.result,
    error: call.error,
  }
}

type BatchResult = {
  created?: unknown[]
  failed?: Array<{
    nodeId: string
    stage: string
    error: { code: string; message: string }
  }>
}

export function SupervisorMessage({
  message,
  onRetry,
  onOpenTask,
  onApplyProposal,
  digestActions = true,
}: {
  message: SupervisorMessageRecord
  onRetry?: () => void
  onOpenTask?: (taskId: string) => void
  onApplyProposal?: (proposalId: string) => Promise<boolean> | boolean | void
  digestActions?: boolean
}) {
  const singleCards = message.toolCalls
    .filter((call) => call.name === 'create_task' && call.ok)
    .map((call) => SupervisorTaskCardSchema.safeParse(call.result))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))

  const batchResults = message.toolCalls
    .filter((call) => call.name === 'create_tasks' && call.ok)
    .map((call) => (call.result ?? {}) as BatchResult)
  const batchCards = batchResults
    .flatMap((result) => result.created ?? [])
    .map((item) => SupervisorTaskCardSchema.safeParse(item))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
  const batchFailures = batchResults.flatMap((result) => result.failed ?? [])

  const cards = [...singleCards, ...batchCards]
  // 同一轮可能先建待办、再补一次开工/改标题；保留最后一次，避免卡片显示旧状态。
  const uniqueCards = [...new Map(cards.map((card) => [card.taskId, card])).values()]

  const handoffEntries = message.toolCalls
    .filter((call) => call.name === 'handoff_task' && call.ok)
    .map((call) => SupervisorHandoffResult.safeParse(call.result))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))

  const planResults = message.toolCalls
    .filter((call) => call.name === 'plan_tasks' && call.ok)
    .map((call) => PlanToolResult.safeParse(call.result))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))

  return (
    <article className="flex gap-3">
      <span className="w-9 shrink-0 pt-0.5 text-xs text-muted">{roleLabels[message.role]}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {message.content ? (
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">
            {toPlainText(message.content)}
          </p>
        ) : null}
        {message.status === 'error' && message.error ? (
          <div role="alert" className="rounded-lg border border-danger bg-danger/10 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
              <AlertTriangle size={14} aria-hidden="true" />
              本轮失败 · {message.error.code}
            </p>
            <p className="mt-1 text-xs text-muted">{message.error.message}</p>
            {onRetry ? (
              <Button variant="tertiary" size="sm" className="mt-2" onPress={onRetry}>
                重试
              </Button>
            ) : null}
          </div>
        ) : null}
        {message.meta?.digest ? (
          <SupervisorDigestActions
            items={message.meta.digest.items}
            actionsEnabled={digestActions}
            onOpenTask={onOpenTask}
            onApplyProposal={onApplyProposal}
          />
        ) : null}
        {message.toolCalls.map((call) => (
          <SupervisorToolCard key={call.id} tool={toToolView(call)} />
        ))}
        {batchFailures.length > 0 ? (
          <ul className="space-y-1 text-xs text-danger">
            {batchFailures.map((item) => (
              <li key={`${item.nodeId}-${item.stage}`}>
                {item.nodeId} {item.stage === 'enqueue' ? '入队失败' : '创建失败'}：
                {item.error.message}
              </li>
            ))}
          </ul>
        ) : null}
        {uniqueCards.map((card) => (
          <SupervisorTaskCard key={card.taskId} card={card} />
        ))}
        {planResults.map((result) => (
          <SupervisorPlanCard
            key={result.actionId}
            actionId={result.actionId}
            plan={result.plan}
            initialStatus={result.status}
          />
        ))}
        {handoffEntries.map(({ task: card, handoff, startError }) => (
          <div key={`handoff-${card.taskId}`} className="flex flex-col gap-1">
            <p className="text-xs text-muted">
              交接自《{handoff.fromTitle}》
              {handoff.worktree ? ' · 源任务在隔离 worktree，变更文件不可读' : ''}
            </p>
            <SupervisorTaskCard card={card} />
            {handoff.warnings.length > 0 ? (
              <ul className="space-y-1 text-xs text-warning">
                {handoff.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            {startError ? (
              <p className="text-xs text-danger">已创建，但开工失败：{startError}</p>
            ) : null}
          </div>
        ))}
      </div>
    </article>
  )
}
