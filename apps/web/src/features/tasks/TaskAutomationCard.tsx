import type { ApprovalDecision } from '@baton/protocol'
import { useQuery } from '@tanstack/react-query'
import { getTaskAutomation } from '../../lib/api'
import { queryKeys } from '../../lib/query'

const decisionLabels: Record<ApprovalDecision, string> = {
  allow: '自动批准',
  deny: '自动拒绝',
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

function shortVersion(version: string | null) {
  return version ? version.slice(0, 8) : '无'
}

export function TaskAutomationCard({ taskId }: { taskId: string }) {
  const query = useQuery({
    queryKey: queryKeys.taskAutomation(taskId),
    queryFn: () => getTaskAutomation(taskId),
  })

  if (query.isLoading) {
    return (
      <section className="shrink-0 rounded-lg border border-separator bg-background p-3">
        <h3 className="text-xs font-medium text-muted">自动化记录</h3>
        <p className="mt-1 text-xs text-muted">加载中…</p>
      </section>
    )
  }

  if (query.isError || !query.data) {
    return (
      <section
        role="alert"
        className="shrink-0 rounded-lg border border-danger bg-danger/10 p-3 text-xs text-danger"
      >
        自动化记录加载失败
      </section>
    )
  }

  const data = query.data
  const allowed = data.autoDecisions.filter((item) => item.decision === 'allow').length
  const denied = data.autoDecisions.filter((item) => item.decision === 'deny').length

  return (
    <section
      data-testid="task-automation"
      className="shrink-0 rounded-lg border border-separator bg-background p-3"
    >
      <h3 className="text-xs font-medium text-muted">自动化记录</h3>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground">
        <span>自动批准 {allowed} 次</span>
        {denied > 0 ? <span>自动拒绝 {denied} 次</span> : null}
        <span>自动重试 {data.retryCount} 次</span>
        {data.lastVerifyExitCode !== null ? (
          <span>最近验收退出码 {data.lastVerifyExitCode}</span>
        ) : null}
        <span className="text-muted">策略版本 {shortVersion(data.lastPolicyVersion)}</span>
      </p>
      {data.autoDecisions.length === 0 ? (
        <p className="mt-1 text-xs text-muted">本任务没有自动决策</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {data.autoDecisions.map((item) => (
            <li
              key={item.approvalId}
              className="flex items-center justify-between gap-2 text-xs text-muted"
            >
              <span className="truncate text-foreground">
                {decisionLabels[item.decision]} · {item.toolName} · {item.risk}
              </span>
              <span className="shrink-0">
                {formatTime(item.decidedAt)} · {shortVersion(item.policyVersion)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
