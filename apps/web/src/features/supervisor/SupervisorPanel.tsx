import type { Node as ProtocolNode, SupervisorMessage } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { toast } from '@heroui/react/toast'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getSupervisorMessages, getSupervisorStatus } from '../../lib/api'
import { useCommand } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { SupervisorComposer } from './SupervisorComposer'
import { SupervisorMessageList } from './SupervisorMessageList'
import { SupervisorStatusBar } from './SupervisorStatusBar'
import { createRequestId, type SupervisorTargetAgent } from './supervisor-model'
import { useSupervisorStream, useSupervisorStreamStore } from './stream-store'

export function SupervisorPanel({
  workspaceId,
  contextNodes,
  targetAgent,
}: {
  workspaceId: string | null
  contextNodes: ProtocolNode[]
  targetAgent: SupervisorTargetAgent | null
}) {
  const send = useCommand()
  const stream = useSupervisorStream()
  const [olderMessages, setOlderMessages] = useState<SupervisorMessage[]>([])
  const [olderBefore, setOlderBefore] = useState<string | null>(null)
  const [olderLoaded, setOlderLoaded] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [quickPrompt, setQuickPrompt] = useState('')

  const status = useQuery({
    queryKey: queryKeys.supervisorStatus,
    queryFn: getSupervisorStatus,
  })
  const history = useQuery({
    queryKey: queryKeys.supervisorMessages(workspaceId ?? ''),
    queryFn: () => getSupervisorMessages(workspaceId!),
    enabled: Boolean(workspaceId),
  })

  useEffect(() => {
    setOlderMessages([])
    setOlderBefore(null)
    setOlderLoaded(false)
    setQuickPrompt('')
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
    if (!workspaceId) return
    const meta = userMessage.meta
    try {
      await send({
        type: 'supervisor.send',
        payload: {
          workspaceId,
          requestId: createRequestId(),
          text: userMessage.content,
          contextNodeIds: meta?.contextNodeIds ?? [],
          ...(meta?.targetNodeId ? { targetNodeId: meta.targetNodeId } : {}),
        },
      })
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '重试失败')
    }
  }

  const retry = async (message: SupervisorMessage) => {
    const index = messages.findIndex((item) => item.id === message.id)
    const previousUser = [...messages.slice(0, index)]
      .reverse()
      .find((item) => item.role === 'user')
    if (previousUser) await resend(previousUser)
  }

  return (
    <div data-testid="supervisor-panel" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">总管</h2>
          <p className="mt-1 text-xs text-muted">
            上下文 {contextNodes.length} 个 · 目标 Agent {targetAgent?.title ?? '未选'}
          </p>
        </div>
      </div>
      <SupervisorStatusBar status={status.data} />
      {!workspaceId ? <p className="p-4 text-sm text-muted">先选择一个工作区</p> : null}
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
          onPickQuickPrompt={setQuickPrompt}
        />
      ) : null}
      {workspaceId && history.data ? (
        <SupervisorComposer
          workspaceId={workspaceId}
          contextNodes={contextNodes}
          targetAgent={targetAgent}
          initialText={quickPrompt}
        />
      ) : null}
    </div>
  )
}
