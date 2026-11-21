import type {
  CanvasResponse,
  SessionEventRecord,
  SessionEventsResponse,
  TaskDetailResponse,
} from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, type ReactNode } from 'react'
import { getTask, listSessionEvents } from '../../lib/api'
import { queryKeys } from '../../lib/query'
import { useAppStore } from '../../stores/app'
import { mergeSessionPage } from '../realtime/session-cache'
import { ApprovalCard } from './ApprovalCard'
import { ContextTimeline } from './ContextTimeline'
import { QuestionCard } from './QuestionCard'
import { ReplyComposer } from './ReplyComposer'
import { ReviewCard } from './ReviewCard'
import { DiffViewer } from './DiffViewer'
import { HandoffButton } from './HandoffButton'
import { TaskActions } from './TaskActions'
import { TaskAutomationCard } from './TaskAutomationCard'
import { TaskHeader } from './TaskHeader'
import { TaskHistory } from './TaskHistory'
import { TaskOriginCard } from './TaskOriginCard'
import { Transcript } from './Transcript'
import { WorktreeCard } from './WorktreeCard'
import { sessionStatusLabel } from './labels'

export function TaskDetailPanel({ mobile = false }: { mobile?: boolean }) {
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId)
  const activeTaskId = useAppStore((state) => state.activeTaskId)
  const setSceneTask = useAppStore((state) => state.setSceneTask)
  const setSelectedNode = useAppStore((state) => state.setSelectedNode)
  const setRightPanel = useAppStore((state) => state.setRightPanel)
  const selectedContextNodeIds = useAppStore((state) => state.contextNodeIds)
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
  // 时间线只读；节点是否存在直接从画布缓存判断，不为详情额外发请求。
  const canvas = queryClient.getQueryData<CanvasResponse>(queryKeys.canvas(activeWorkspaceId ?? ''))
  const knownNodeIds = canvas ? new Set(canvas.nodes.map((node) => node.id)) : undefined
  const selectedContextNodes = canvas
    ? canvas.nodes.filter((node) => selectedContextNodeIds.includes(node.id))
    : []

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
    await queryClient.invalidateQueries({ queryKey: queryKeys.taskHistory(taskId) })
    if (activeWorkspaceId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks(activeWorkspaceId) })
    }
  }, [activeWorkspaceId, detail.data?.task.id, queryClient])

  const openScene = useCallback(() => {
    if (!activeTaskId) return
    setSceneTask(activeTaskId)
    setSelectedNode(null)
    setRightPanel('task')
  }, [activeTaskId, setRightPanel, setSceneTask, setSelectedNode])

  return (
    <div
      data-testid="task-detail"
      className={mobile ? 'flex min-h-0 flex-1 flex-col' : 'flex min-h-0 flex-1 flex-col gap-3 p-4'}
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
        mobile ? (
          <>
            <div data-testid="mobile-task-scroll" className="min-h-0 flex-1 overflow-y-auto p-4">
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
                onOpenScene={undefined}
                knownNodeIds={knownNodeIds}
                onSelectNode={setSelectedNode}
                contextNodes={selectedContextNodes}
                mobile
                showActions={false}
              />
            </div>
            {['todo', 'queued', 'running', 'failed', 'done', 'cancelled'].includes(
              detail.data.task.status,
            ) ||
            (detail.data.task.status === 'waiting_input' &&
              detail.data.attention === 'needs_attention') ? (
              <div
                data-testid="mobile-task-footer"
                className="shrink-0 border-t border-separator bg-background p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
              >
                <TaskActions
                  taskId={detail.data.task.id}
                  workspaceId={activeWorkspaceId}
                  status={detail.data.task.status}
                  attention={detail.data.attention}
                />
              </div>
            ) : null}
          </>
        ) : (
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
            onOpenScene={openScene}
            knownNodeIds={knownNodeIds}
            onSelectNode={setSelectedNode}
            contextNodes={selectedContextNodes}
            mobile={false}
            showActions
          />
        )
      ) : null}
    </div>
  )
}

function MobileCollapsible({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="shrink-0 rounded-lg border border-separator bg-surface p-3">
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
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
  onOpenScene,
  knownNodeIds,
  onSelectNode,
  contextNodes,
  mobile,
  showActions,
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
  onOpenScene?: (() => void) | undefined
  knownNodeIds: ReadonlySet<string> | undefined
  onSelectNode: (nodeId: string) => void
  contextNodes: CanvasResponse['nodes']
  mobile: boolean
  showActions: boolean
}) {
  const task = detail.task
  const pendingApprovals = [...detail.approvals].reverse().filter((item) => item.decision === null)
  const needsApproval = detail.attention === 'needs_approval'
  const [historyDiffReviewId, setHistoryDiffReviewId] = useState<string | null>(null)
  const hasCost = detail.sessions.some((session) => session.costUsd !== null)
  const hasTurns = detail.sessions.some((session) => session.turns !== null)
  const totalCost = detail.sessions.reduce((sum, session) => sum + (session.costUsd ?? 0), 0)
  const totalTurns = detail.sessions.reduce((sum, session) => sum + (session.turns ?? 0), 0)
  const lastSession = detail.sessions.at(-1)

  return (
    <>
      <TaskHeader
        task={task}
        attention={detail.attention}
        waitingSince={detail.waitingSince}
        {...(onOpenScene ? { onOpenScene } : {})}
      />
      {detail.sessions.length > 0 ? (
        <p className="text-xs text-muted">
          累计 {hasCost ? `$${totalCost.toFixed(2)}` : '—'} ·{' '}
          {hasTurns ? `${totalTurns} turns` : '—'}
        </p>
      ) : null}
      {mobile ? (
        <MobileCollapsible title="上下文与来源">
          <div className="flex flex-col gap-2">
            <ContextTimeline
              snapshot={task.context}
              invalid={detail.contextInvalid}
              targetNodeId={task.nodeId}
              knownNodeIds={knownNodeIds}
              onSelectNode={onSelectNode}
            />
            <TaskOriginCard origin={task.origin} invalid={detail.originInvalid} />
          </div>
        </MobileCollapsible>
      ) : (
        <>
          <ContextTimeline
            snapshot={task.context}
            invalid={detail.contextInvalid}
            targetNodeId={task.nodeId}
            knownNodeIds={knownNodeIds}
            onSelectNode={onSelectNode}
          />
          <TaskOriginCard origin={task.origin} invalid={detail.originInvalid} />
        </>
      )}
      {mobile ? (
        <MobileCollapsible title="自动化记录">
          <TaskAutomationCard taskId={task.id} />
        </MobileCollapsible>
      ) : (
        <TaskAutomationCard taskId={task.id} />
      )}

      <WorktreeCard
        taskId={task.id}
        worktreePath={task.worktreePath}
        canCleanup={!mobile && ['review', 'done', 'cancelled', 'failed'].includes(task.status)}
        onDone={onDone}
      />

      <TaskHistory taskId={task.id} onOpenDiff={setHistoryDiffReviewId} />
      {historyDiffReviewId ? (
        <DiffViewer reviewId={historyDiffReviewId} onClose={() => setHistoryDiffReviewId(null)} />
      ) : null}

      {task.status === 'waiting_input' && needsApproval ? (
        pendingApprovals.length > 0 ? (
          <div className="flex shrink-0 flex-col gap-2">
            {pendingApprovals.map((approval) =>
              approval.request.toolName === 'AskUserQuestion' ? (
                <QuestionCard key={approval.id} approval={approval} onDone={onDone} />
              ) : (
                <ApprovalCard key={approval.id} approval={approval} onDone={onDone} />
              ),
            )}
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
          <ReviewCard
            review={detail.review}
            usage={lastSession ? { costUsd: lastSession.costUsd, turns: lastSession.turns } : null}
            contextNodes={contextNodes}
            onDone={onDone}
          />
        ) : (
          <p className="shrink-0 text-sm text-muted">等待验收记录同步…</p>
        )
      ) : null}

      <HandoffButton taskId={task.id} workspaceId={workspaceId} status={task.status} />

      {showActions ? (
        <TaskActions
          taskId={task.id}
          workspaceId={workspaceId}
          status={task.status}
          attention={detail.attention}
          sticky={mobile}
        />
      ) : null}

      {['done', 'failed', 'cancelled'].includes(task.status) && !showActions ? (
        <p className="shrink-0 text-sm text-muted">任务已结束。</p>
      ) : null}

      <div
        data-testid="transcript-section"
        className={
          mobile
            ? 'flex h-[45vh] min-h-64 flex-col border-t border-separator pt-3'
            : 'flex min-h-0 flex-1 flex-col border-t border-separator pt-3'
        }
      >
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
                会话 {index + 1} · {sessionStatusLabel(session.status)}
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
