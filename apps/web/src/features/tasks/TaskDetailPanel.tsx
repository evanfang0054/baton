import type { SessionEventRecord, SessionEventsResponse, TaskDetailResponse } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { getTask, listSessionEvents } from '../../lib/api'
import { queryKeys } from '../../lib/query'
import { useAppStore } from '../../stores/app'
import { mergeSessionPage } from '../realtime/session-cache'
import { ApprovalCard } from './ApprovalCard'
import { ReplyComposer } from './ReplyComposer'
import { ReviewCard } from './ReviewCard'
import { TaskActions } from './TaskActions'
import { TaskHeader } from './TaskHeader'
import { Transcript } from './Transcript'

const sessionStatusLabels: Record<string, string> = {
  running: '进行中',
  waiting_input: '等待输入',
  ended: '已结束',
  failed: '失败',
}

export function TaskDetailPanel() {
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId)
  const activeTaskId = useAppStore((state) => state.activeTaskId)
  const queryClient = useQueryClient()
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  const detail = useQuery({
    queryKey: queryKeys.task(activeTaskId ?? ''),
    queryFn: () => getTask(activeTaskId!),
    enabled: Boolean(activeTaskId),
  })

  const sessions = detail.data?.sessions ?? []
  const activeSession =
    sessions.find((session) => session.id === selectedSessionId) ?? sessions.at(-1) ?? null

  const events = useQuery({
    queryKey: queryKeys.sessionEvents(activeSession?.id ?? ''),
    queryFn: () => listSessionEvents(activeSession!.id, 0, 500),
    enabled: Boolean(activeSession?.id),
  })
  const [loadMorePending, setLoadMorePending] = useState(false)

  const loadMore = useCallback(async () => {
    const sessionId = activeSession?.id
    if (!sessionId || !events.data?.hasMore || loadMorePending) return
    setLoadMorePending(true)
    try {
      const page = await listSessionEvents(sessionId, events.data.nextSeq, 500)
      queryClient.setQueryData<SessionEventsResponse>(
        queryKeys.sessionEvents(sessionId),
        (previous) => mergeSessionPage(previous, page),
      )
    } finally {
      setLoadMorePending(false)
    }
  }, [activeSession?.id, events.data, loadMorePending, queryClient])

  const onDone = useCallback(async () => {
    const taskId = detail.data?.task.id
    if (!taskId) return
    await queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) })
    if (activeWorkspaceId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks(activeWorkspaceId) })
    }
  }, [activeWorkspaceId, detail.data?.task.id, queryClient])

  return (
    <aside
      data-testid="task-detail"
      className="flex min-h-0 w-[380px] shrink-0 flex-col gap-3 border-l border-separator bg-surface p-4"
    >
      {!activeWorkspaceId ? (
        <p className="text-sm text-muted">尚未选择工作区</p>
      ) : !activeTaskId ? (
        <p className="text-sm text-muted">选择一个任务</p>
      ) : detail.isLoading ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : detail.isError ? (
        <p className="text-sm text-danger">任务加载失败</p>
      ) : detail.data ? (
        <DetailContent
          key={detail.data.task.id}
          detail={detail.data}
          workspaceId={activeWorkspaceId}
          activeSessionId={activeSession?.id ?? null}
          onSelectSession={setSelectedSessionId}
          events={events.data?.events ?? []}
          eventsLoading={events.isLoading}
          hasMore={events.data?.hasMore ?? false}
          loadMorePending={loadMorePending}
          onLoadMore={loadMore}
          onDone={onDone}
        />
      ) : null}
    </aside>
  )
}

function DetailContent({
  detail,
  workspaceId,
  activeSessionId,
  onSelectSession,
  events,
  eventsLoading,
  hasMore,
  loadMorePending,
  onLoadMore,
  onDone,
}: {
  detail: TaskDetailResponse
  workspaceId: string
  activeSessionId: string | null
  onSelectSession: (sessionId: string) => void
  events: SessionEventRecord[]
  eventsLoading: boolean
  hasMore: boolean
  loadMorePending: boolean
  onLoadMore: () => void
  onDone: () => Promise<void>
}) {
  const task = detail.task
  const pendingApprovals = [...detail.approvals].reverse().filter((item) => item.decision === null)
  const needsApproval = detail.attention === 'needs_approval'

  return (
    <>
      <TaskHeader task={task} attention={detail.attention} waitingSince={detail.waitingSince} />

      {task.status === 'waiting_input' && needsApproval ? (
        pendingApprovals.length > 0 ? (
          <div className="flex shrink-0 flex-col gap-2">
            {pendingApprovals.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} onDone={onDone} />
            ))}
          </div>
        ) : (
          <p className="shrink-0 text-sm text-muted">等待审批记录同步…</p>
        )
      ) : null}

      {task.status === 'waiting_input' && detail.attention === 'needs_reply' ? (
        <ReplyComposer taskId={task.id} onDone={onDone} />
      ) : null}

      {task.status === 'review' ? (
        detail.review ? (
          <ReviewCard review={detail.review} onDone={onDone} />
        ) : (
          <p className="shrink-0 text-sm text-muted">等待验收记录同步…</p>
        )
      ) : null}

      <TaskActions
        taskId={task.id}
        workspaceId={workspaceId}
        status={task.status}
        attention={detail.attention}
      />

      {['done', 'failed', 'cancelled'].includes(task.status) ? (
        <p className="shrink-0 text-sm text-muted">任务已结束，只读。</p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col border-t border-separator pt-3">
        <div className="mb-2 flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted">会话</span>
          <select
            aria-label="会话"
            value={activeSessionId ?? ''}
            onChange={(event) => onSelectSession(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-lg border border-separator bg-background px-2 text-xs text-foreground"
            disabled={detail.sessions.length === 0}
          >
            {detail.sessions.length === 0 ? <option value="">暂无会话</option> : null}
            {detail.sessions.map((session, index) => (
              <option key={session.id} value={session.id}>
                会话 {index + 1} · {sessionStatusLabels[session.status] ?? session.status}
              </option>
            ))}
          </select>
        </div>
        {hasMore ? (
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <p className="text-xs text-muted">还有更多会话记录未加载</p>
            <Button
              variant="tertiary"
              isDisabled={loadMorePending}
              onPress={onLoadMore}
              className="shrink-0"
            >
              加载更多
            </Button>
          </div>
        ) : null}
        <Transcript key={activeSessionId ?? 'none'} events={events} loading={eventsLoading} />
      </div>
    </>
  )
}
