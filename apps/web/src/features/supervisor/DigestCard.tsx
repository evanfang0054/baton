import type { AttentionItem, DigestReport, Notice } from '@baton/protocol'
import { DigestReport as DigestReportSchema } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { toast } from '@heroui/react/toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { generateDigest, listNotices, readNotice } from '../../lib/api'
import { queryKeys } from '../../lib/query'
import { StatusChip } from '../tasks/StatusChip'
import { WaitingTime } from '../tasks/WaitingTime'

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

function parseReport(notice: Notice | null): DigestReport | null {
  if (!notice) return null
  const parsed = DigestReportSchema.safeParse(notice.payload)
  return parsed.success ? parsed.data : null
}

export function DigestCard({
  workspaceId,
  notice: providedNotice,
  onRead,
  onOpenTask,
  onGenerate,
  onDecideAction,
}: {
  workspaceId?: string
  notice?: Notice
  onRead?: (noticeId: string) => void
  onOpenTask?: (taskId: string) => void
  onGenerate?: () => void
  onDecideAction?: (actionId: string, decision: 'apply' | 'ignore') => Promise<void> | void
}) {
  const queryClient = useQueryClient()
  const controlled = providedNotice !== undefined
  const notices = useQuery({
    queryKey: queryKeys.notices(workspaceId ?? ''),
    queryFn: () => listNotices(workspaceId!, { kind: 'digest', limit: 5 }),
    enabled: Boolean(workspaceId) && !controlled,
  })
  const [showHistory, setShowHistory] = useState(false)
  const [generating, setGenerating] = useState(false)

  const history = notices.data?.notices ?? []
  const notice = controlled ? providedNotice : (history[0] ?? null)
  const report = useMemo(() => parseReport(notice ?? null), [notice])

  if (!workspaceId && !controlled) return null

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.notices(workspaceId ?? '') })

  const markRead = async () => {
    if (!notice || notice.readAt !== null) return
    if (onRead) {
      onRead(notice.id)
      return
    }
    try {
      await readNotice(notice.id)
      await invalidate()
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '标记已读失败')
    }
  }

  const generate = async () => {
    if (onGenerate) {
      onGenerate()
      return
    }
    if (!workspaceId) return
    setGenerating(true)
    try {
      await generateDigest(workspaceId)
      await invalidate()
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '生成汇报失败')
    } finally {
      setGenerating(false)
    }
  }

  const attentionCount = report
    ? report.snapshot.attention.needsApproval +
      report.snapshot.attention.needsReply +
      report.snapshot.attention.needsAttention
    : 0
  // dropped 也是 waiting_input，但 attention 会把它算进 needs_reply；展示时扣除。
  const pendingCount = Math.max(0, attentionCount - (report?.dropped.length ?? 0))
  const blocked = report?.blocked.slice(0, 3) ?? []
  const dropped = report?.dropped.slice(0, 3) ?? []

  return (
    <section
      data-testid="digest-card"
      aria-label="本轮汇报"
      className="flex shrink-0 flex-col gap-2 border-b border-separator px-4 py-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold text-foreground">本轮汇报</h3>
          {notice?.readAt === null ? (
            <span
              data-testid="digest-unread"
              aria-label="未读"
              className="h-1.5 w-1.5 rounded-full bg-accent"
            />
          ) : null}
          {notice ? <span className="text-xs text-muted">{formatTime(notice.ts)}</span> : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="tertiary"
            size="sm"
            isDisabled={generating}
            onPress={() => void generate()}
          >
            生成汇报
          </Button>
          {history.length > 0 ? (
            <Button variant="tertiary" size="sm" onPress={() => setShowHistory((open) => !open)}>
              历史
            </Button>
          ) : null}
        </div>
      </div>

      {!report ? (
        notices.isError ? (
          <div role="alert" className="flex items-center justify-between gap-2 text-xs text-danger">
            <span>汇报加载失败</span>
            <Button variant="tertiary" size="sm" onPress={() => void notices.refetch()}>
              重试
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted">还没有汇报</p>
        )
      ) : (
        <>
          <p aria-live="polite" className="text-xs text-muted">
            共 {report.snapshot.total} 个任务：待处理 {pendingCount}，待验收{' '}
            {report.snapshot.attention.needsReview}，进行中 {report.snapshot.running}
          </p>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-md bg-default px-2 py-0.5">待处理 {pendingCount}</span>
            <span className="rounded-md bg-default px-2 py-0.5">
              待验收 {report.snapshot.attention.needsReview}
            </span>
            <span className="rounded-md bg-default px-2 py-0.5">
              进行中 {report.snapshot.running}
            </span>
            <span className="rounded-md bg-default px-2 py-0.5">
              已放弃 {report.dropped.length}
            </span>
          </div>
          <p className="text-xs text-muted">
            变化：新增 {report.changes.created} · 完成 {report.changes.completed} · 失败{' '}
            {report.changes.failed} · 重试 {report.changes.retried} · 自动批准{' '}
            {report.changes.autoAllowed} · 自动拒绝 {report.changes.autoDenied}
          </p>
          {report.attention.items.length > 0 ? (
            <section
              aria-label="需要你决定"
              className="flex flex-col gap-1 rounded-md bg-default p-2"
            >
              <h4 className="text-xs font-semibold text-foreground">需要你决定</h4>
              <ul className="flex flex-col gap-1">
                {report.attention.items.map((item: AttentionItem) => {
                  const action = item.action
                  return (
                    <li key={item.taskId} className="flex flex-col gap-1 rounded-md px-1 py-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-foreground">{item.title}</span>
                        {item.waitingSince !== null ? (
                          <WaitingTime since={item.waitingSince} />
                        ) : null}
                      </div>
                      <p className="text-xs text-muted">{item.reason}</p>
                      {action.type === 'apply_proposal' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onPress={() => void onDecideAction?.(action.proposalId, 'apply')}
                        >
                          应用建议
                        </Button>
                      ) : (
                        <Button
                          variant="tertiary"
                          size="sm"
                          onPress={() => onOpenTask?.(item.taskId)}
                        >
                          {action.type === 'open_review' ? '去验收' : '打开任务'}
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}
          {report.oldestWaiting ? (
            <p className="text-xs text-muted">最久等待：{report.oldestWaiting.title}</p>
          ) : null}
          {blocked.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {blocked.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => onOpenTask?.(task.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left text-xs hover:bg-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span className="truncate text-foreground">{task.title}</span>
                    <StatusChip status={task.status} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {dropped.length > 0 ? (
            <p className="text-xs text-muted">
              已放弃：{dropped.map((task) => task.title).join('、')}
            </p>
          ) : null}
          {notice?.readAt === null ? (
            <div>
              <Button variant="tertiary" size="sm" onPress={() => void markRead()}>
                知道了
              </Button>
            </div>
          ) : null}
        </>
      )}

      {showHistory && history.length > 0 ? (
        <ul className="flex flex-col gap-1 border-t border-separator pt-2">
          {history.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between text-xs text-muted">
              <span>{formatTime(entry.ts)}</span>
              <span>{entry.readAt === null ? '未读' : '已读'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
