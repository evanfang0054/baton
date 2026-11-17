import type { SessionEventRecord, TaskDetailResponse } from '@baton/protocol'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { getTask, listSessionEvents } from '../../lib/api'
import { queryKeys } from '../../lib/query'
import { useAppStore } from '../../stores/app'
import { ApprovalCard } from './ApprovalCard'
import { ReplyComposer } from './ReplyComposer'
import { ReviewCard } from './ReviewCard'
import { TaskActions } from './TaskActions'
import { TaskHeader } from './TaskHeader'
import { Transcript } from './Transcript'

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
          detail={detail.data}
          workspaceId={activeWorkspaceId}
          activeSessionId={activeSession?.id ?? null}
          onSelectSession={setSelectedSessionId}
          events={events.data?.events ?? []}
          eventsLoading={events.isLoading}
          hasMore={events.data?.hasMore ?? false}
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
  onDone,
}: {
  detail: TaskDetailResponse
  workspaceId: string
  activeSessionId: string | null
  onSelectSession: (sessionId: string) => void
  events: SessionEventRecord[]
  eventsLoading: boolean
  hasMore: boolean
  onDone: () => Promise<void>
}) {
  const task = detail.task
  const pendingApproval = [...detail.approvals].reverse().find((item) => item.decision === null)
  const needsApproval = task.waitingReason === 'approval' || task.waitingReason === null

  return (
    <>
      <TaskHeader task={task} attention={detail.attention} waitingSince={detail.waitingSince} />

      {task.status === 'waiting_input' && needsApproval ? (
        pendingApproval ? (
          <ApprovalCard approval={pendingApproval} onDone={onDone} />
        ) : (
          <p className="shrink-0 text-sm text-muted">等待审批记录同步…</p>
        )
      ) : null}

      {task.status === 'waiting_input' && !needsApproval ? (
        <ReplyComposer taskId={task.id} onDone={onDone} />
      ) : null}

      {task.status === 'review' ? (
        detail.review ? (
          <ReviewCard review={detail.review} onDone={onDone} />
        ) : (
          <p className="shrink-0 text-sm text-muted">等待验收记录同步…</p>
        )
      ) : null}

      <TaskActions taskId={task.id} workspaceId={workspaceId} status={task.status} />

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
                会话 {index + 1} · {session.status}
              </option>
            ))}
          </select>
        </div>
        {hasMore ? (
          <p className="mb-2 shrink-0 text-xs text-muted">仅显示前 500 条会话记录</p>
        ) : null}
        <Transcript events={events} loading={eventsLoading} />
      </div>
    </>
  )
}
