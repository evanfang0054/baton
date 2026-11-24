import type { Node as ProtocolNode, SupervisorMessage } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { toast } from '@heroui/react/toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getSupervisorMessages, getSupervisorStatus, listNotices, readNotice } from '../../lib/api'
import { useCommand } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { useAppStore } from '../../stores/app'
import { SupervisorComposer } from './SupervisorComposer'
import { SupervisorMessageList } from './SupervisorMessageList'
import { SupervisorStatusBar } from './SupervisorStatusBar'
import { createRequestId, type SupervisorTargetAgent } from './supervisor-model'
import { useSupervisorStream, useSupervisorStreamStore } from './stream-store'

export function SupervisorPanel({
  workspaceId,
  deliveryId = null,
  stageKey = null,
  scopeLabel,
  contextNodes,
  targetAgent,
  mobile = false,
  nodes = [],
}: {
  workspaceId: string | null
  deliveryId?: string | null
  stageKey?: string | null
  scopeLabel?: string
  contextNodes: ProtocolNode[]
  targetAgent: SupervisorTargetAgent | null
  mobile?: boolean
  nodes?: ProtocolNode[]
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const stream = useSupervisorStream()
  const [olderMessages, setOlderMessages] = useState<SupervisorMessage[]>([])
  const [olderBefore, setOlderBefore] = useState<string | null>(null)
  const [olderLoaded, setOlderLoaded] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [quickPrompt, setQuickPrompt] = useState({ text: '', seq: 0 })
  const readNoticeIds = useRef(new Set<string>())

  const status = useQuery({
    queryKey: queryKeys.supervisorStatus,
    queryFn: getSupervisorStatus,
  })
  const history = useQuery({
    queryKey: queryKeys.supervisorMessages(workspaceId ?? ''),
    queryFn: () => getSupervisorMessages(workspaceId!),
    enabled: Boolean(workspaceId),
  })
  const notices = useQuery({
    queryKey: queryKeys.notices(workspaceId ?? ''),
    queryFn: () => listNotices(workspaceId!, { kind: 'digest', limit: 1 }),
    enabled: Boolean(workspaceId),
  })

  // 汇报已进入聊天流；面板打开即视为看过最新汇报，收起时保留未读圆点。
  useEffect(() => {
    const latest = notices.data?.notices[0]
    if (!workspaceId || !latest || latest.readAt !== null) return
    // 服务端未回写 readAt 时也不能反复打已读接口。
    if (readNoticeIds.current.has(latest.id)) return
    readNoticeIds.current.add(latest.id)
    void readNotice(latest.id)
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.notices(workspaceId) }))
      .catch(() => {
        // 已读失败不影响聊天；圆点会保留到下一次打开。
      })
  }, [notices.data?.notices, queryClient, workspaceId])

  useEffect(() => {
    setOlderMessages([])
    setOlderBefore(null)
    setOlderLoaded(false)
    setQuickPrompt({ text: '', seq: 0 })
    readNoticeIds.current.clear()
    useSupervisorStreamStore.getState().reset()
  }, [workspaceId])

  const messages = useMemo(() => {
    const merged = [...olderMessages, ...(history.data?.messages ?? [])]
    const seen = new Set<string>()
    return merged.filter((message) => {
      if (seen.has(message.id)) return false
      seen.add(message.id)
      return true
    })
  }, [history.data?.messages, olderMessages])

  const nextBefore = olderLoaded ? olderBefore : (history.data?.nextBefore ?? null)
  const lastMessage = messages.at(-1)
  const incomplete =
    lastMessage?.role === 'user' && stream.status !== 'streaming' ? lastMessage : null

  const loadOlder = async () => {
    if (!workspaceId || !nextBefore || loadingOlder) return
    setLoadingOlder(true)
    try {
      const page = await getSupervisorMessages(workspaceId, nextBefore)
      setOlderMessages((previous) => [...page.messages, ...previous])
      setOlderBefore(page.nextBefore ?? null)
      setOlderLoaded(true)
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '更早的总管消息加载失败')
    } finally {
      setLoadingOlder(false)
    }
  }

  const resend = async (userMessage: SupervisorMessage) => {
    if (!workspaceId || retrying || stream.status === 'streaming') return
    const meta = userMessage.meta
    const scope =
      meta?.deliveryId && meta.stageKey
        ? { deliveryId: meta.deliveryId, stageKey: meta.stageKey }
        : null
    setRetrying(true)
    // 与输入框保持一致：重试后立刻进入“正在思考”，避免重复点击再发一轮。
    useSupervisorStreamStore.getState().waitForReply()
    try {
      await send({
        type: 'supervisor.send',
        payload: {
          workspaceId,
          requestId: createRequestId(),
          text: userMessage.content,
          contextNodeIds: meta?.contextNodeIds ?? [],
          ...(meta?.targetNodeId ? { targetNodeId: meta.targetNodeId } : {}),
          ...(scope ?? {}),
        },
      })
    } catch (cause) {
      useSupervisorStreamStore.getState().reset()
      toast.danger(cause instanceof Error ? cause.message : '重试失败')
    } finally {
      setRetrying(false)
    }
  }

  const retry = async (message: SupervisorMessage) => {
    const index = messages.findIndex((item) => item.id === message.id)
    const previousUser = [...messages.slice(0, index)]
      .reverse()
      .find((item) => item.role === 'user')
    if (previousUser) await resend(previousUser)
  }
  const openTask = (taskId: string) => {
    const state = useAppStore.getState()
    state.setSelectedNode(null)
    state.openStage(taskId)
  }
  const openDrawing = (drawingDeliveryId: string, artifactId: string) => {
    const state = useAppStore.getState()
    state.setSelectedNode(null)
    state.setDelivery(drawingDeliveryId)
    state.setOverlay({ kind: 'drawing', deliveryId: drawingDeliveryId, artifactId })
  }
  const applyProposal = async (proposalId: string): Promise<boolean> => {
    if (!workspaceId) return false
    try {
      await send({
        type: 'supervisor.action.decide',
        payload: { workspaceId, actionId: proposalId, decision: 'apply' },
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.notices(workspaceId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks(workspaceId) })
      return true
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '应用建议失败')
      return false
    }
  }

  return (
    <div data-testid="supervisor-panel" className="flex h-full min-h-0 flex-col">
      <SupervisorStatusBar status={status.data} />
      {!workspaceId ? <p className="p-4 text-sm text-muted">先选择一个项目</p> : null}
      {workspaceId && status.isError ? (
        <div role="alert" className="m-4 rounded-lg border border-danger bg-danger/10 p-3">
          <p className="text-sm font-medium text-danger">无法读取总管状态</p>
          <Button
            variant="tertiary"
            size="sm"
            className="mt-2"
            onPress={() => void status.refetch()}
          >
            重试
          </Button>
        </div>
      ) : null}
      {workspaceId && status.data && !status.data.configured ? (
        <div role="alert" className="m-4 rounded-lg border border-warning bg-warning/10 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
            <AlertTriangle size={16} aria-hidden="true" />
            总管未配置模型
          </p>
          <p className="mt-1 text-xs text-muted">
            在数据目录的 supervisor.json 中补齐模型配置后重试。
          </p>
          {status.data.errorCode ? (
            <p className="mt-1 font-mono text-xs text-muted">{status.data.errorCode}</p>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            isDisabled={status.isFetching}
            onPress={() => void status.refetch()}
          >
            检查配置
          </Button>
        </div>
      ) : null}
      {workspaceId && history.isLoading ? <p className="p-4 text-sm text-muted">加载中…</p> : null}
      {workspaceId && history.isError ? (
        <div role="alert" className="m-4 rounded-lg border border-danger bg-danger/10 p-3">
          <p className="text-sm font-medium text-danger">总管历史加载失败</p>
          <Button
            variant="tertiary"
            size="sm"
            className="mt-2"
            onPress={() => void history.refetch()}
          >
            重试
          </Button>
        </div>
      ) : null}
      {workspaceId && history.data ? (
        <SupervisorMessageList
          messages={messages}
          stream={stream}
          incomplete={incomplete}
          canLoadOlder={Boolean(nextBefore)}
          loadingOlder={loadingOlder}
          onLoadOlder={() => void loadOlder()}
          onRetry={(message) => void retry(message)}
          onRetryIncomplete={() => incomplete && void resend(incomplete)}
          onPickQuickPrompt={(text) =>
            setQuickPrompt((previous) => ({ text, seq: previous.seq + 1 }))
          }
          onOpenTask={openTask}
          onOpenDrawing={openDrawing}
          onApplyProposal={applyProposal}
        />
      ) : null}
      {workspaceId && history.data ? (
        <SupervisorComposer
          workspaceId={workspaceId}
          deliveryId={deliveryId}
          stageKey={stageKey}
          {...(scopeLabel ? { scopeLabel } : {})}
          contextNodes={contextNodes}
          targetAgent={targetAgent}
          initialText={quickPrompt.text}
          initialTextKey={quickPrompt.seq}
          mobile={mobile}
          nodes={nodes}
        />
      ) : null}
    </div>
  )
}
