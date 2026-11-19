import type { ReviewView, Session, TaskStatusHistoryItem } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { getTaskHistory } from '../../lib/api'
import { queryKeys } from '../../lib/query'

const statusLabels: Record<TaskStatusHistoryItem['status'], string> = {
  todo: '待办',
  queued: '排队',
  running: '进行中',
  waiting_input: '等待输入',
  verifying: '验收中',
  review: '待验收',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const sessionLabels: Record<string, string> = {
  running: '进行中',
  waiting_input: '等待输入',
  ended: '已结束',
  failed: '失败',
}

type TimelineItem =
  | { kind: 'status'; key: string; ts: number; status: TaskStatusHistoryItem }
  | { kind: 'session'; key: string; ts: number; session: Session }
  | { kind: 'review'; key: string; ts: number; review: ReviewView }

export function TaskHistory({
  taskId,
  onOpenDiff,
}: {
  taskId: string
  onOpenDiff?: (reviewId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: queryKeys.taskHistory(taskId),
    queryFn: () => getTaskHistory(taskId),
    enabled: open,
  })

  const items = useMemo<TimelineItem[]>(() => {
    const data = query.data
    if (!data) return []
    return [
      ...data.statusEvents.map((status) => ({
        kind: 'status' as const,
        key: `status-${status.ordinal}`,
        ts: status.ts,
        status,
      })),
      ...data.sessions.map((session) => ({
        kind: 'session' as const,
        key: `session-${session.id}`,
        ts: session.startedAt,
        session,
      })),
      ...data.reviews.map((review) => ({
        kind: 'review' as const,
        key: `review-${review.id}`,
        ts: review.decidedAt ?? 0,
        review,
      })),
    ].sort((a, b) => b.ts - a.ts)
  }, [query.data])

  return (
    <section
      data-testid="task-history"
      className="shrink-0 rounded-lg border border-separator bg-surface p-3"
    >
      <button
        type="button"
        aria-expanded={open}
        className="text-sm font-medium"
        onClick={() => setOpen((value) => !value)}
      >
        历史
      </button>
      <div className="mt-2">
        {!open ? null : query.isLoading ? (
          <p className="text-xs text-muted">加载中…</p>
        ) : query.isError ? (
          <p role="alert" className="text-xs text-danger">
            历史加载失败
          </p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted">还没有记录。</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.key}
                className="rounded-lg border border-separator bg-background px-2 py-1.5 text-xs"
              >
                {item.kind === 'status' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground">{statusLabels[item.status.status]}</span>
                    <span className="text-muted">
                      原 {statusLabels[item.status.previousStatus]}
                    </span>
                    {item.status.retryCount > 0 ? (
                      <span className="text-warning">重试 {item.status.retryCount}</span>
                    ) : null}
                    {item.status.cause?.reason ? (
                      <span className="text-muted">{item.status.cause.reason}</span>
                    ) : null}
                  </div>
                ) : item.kind === 'session' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground">
                      会话 {sessionLabels[item.session.status] ?? item.session.status}
                    </span>
                    {item.session.outcome ? (
                      <span className="text-muted">结果 {item.session.outcome}</span>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground">
                      验收 · 退出码 {item.review.verifyExitCode}
                    </span>
                    <span className="text-muted">
                      {item.review.verdict === 'approved'
                        ? '通过'
                        : item.review.verdict === 'rejected'
                          ? '打回'
                          : '待决定'}
                    </span>
                    {item.review.diffAvailable && onOpenDiff ? (
                      <Button
                        size="sm"
                        variant="tertiary"
                        onPress={() => onOpenDiff(item.review.id)}
                      >
                        查看改动
                      </Button>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
