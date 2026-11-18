import type {
  Node as ProtocolNode,
  SupervisorMessage,
  SupervisorMessagesResponse,
} from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { TextArea } from '@heroui/react/textarea'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useCommand } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { useAppStore } from '../../stores/app'
import { nodeTitle } from '../canvas/node-title'
import { createRequestId, type SupervisorTargetAgent } from './supervisor-model'
import { useSupervisorStream, useSupervisorStreamStore } from './stream-store'

const typeLabels: Record<ProtocolNode['type'], string> = {
  text: '文本',
  file: '文件',
  agent: 'Agent',
  image: '图片',
  review: '验收',
  group: '分组',
}

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-accent'

function contextLabel(node: ProtocolNode): string {
  try {
    return nodeTitle(node)
  } catch {
    return node.type
  }
}

export function SupervisorComposer({
  workspaceId,
  contextNodes,
  targetAgent,
  initialText = '',
  initialTextKey = 0,
}: {
  workspaceId: string
  contextNodes: ProtocolNode[]
  targetAgent: SupervisorTargetAgent | null
  initialText?: string
  initialTextKey?: number
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const removeContextNode = useAppStore((state) => state.removeContextNode)
  const clearContext = useAppStore((state) => state.clearContext)
  const stream = useSupervisorStream()
  const [text, setText] = useState(initialText)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const busy = sending || stream.status === 'streaming'

  useEffect(() => {
    // 同一个快捷提示可能被再次选中；用 key 让写入生效，而不是依赖文本变化。
    if (initialText) setText(initialText)
  }, [initialText, initialTextKey])

  const submit = async () => {
    const value = text.trim()
    if (!value || busy) return
    setSending(true)
    setSendError(null)
    // 发送失败时保留同一个 requestId，重试由服务端幂等去重，不会重复建任务。
    const requestId = (requestIdRef.current ??= createRequestId())
    const contextNodeIds = contextNodes.map((node) => node.id)
    const targetNodeId = targetAgent?.id
    const messagesKey = queryKeys.supervisorMessages(workspaceId)
    const optimisticId = `pending-${requestId}`
    const optimistic: SupervisorMessage = {
      id: optimisticId,
      threadId: queryClient.getQueryData<SupervisorMessagesResponse>(messagesKey)?.threadId ?? '',
      role: 'user',
      content: value,
      toolCalls: [],
      decision: null,
      meta: { contextNodeIds, targetNodeId: targetNodeId ?? null },
      status: 'ok',
      error: null,
      createdAt: Date.now(),
    }
    // 先让用户看到自己发出的消息和“正在思考”，不要等最终消息落库才出现。
    queryClient.setQueryData<SupervisorMessagesResponse>(messagesKey, (previous) =>
      previous ? { ...previous, messages: [...previous.messages, optimistic] } : previous,
    )
    useSupervisorStreamStore.getState().waitForReply()
    try {
      await send({
        type: 'supervisor.send',
        payload: {
          workspaceId,
          requestId,
          text: value,
          contextNodeIds,
          ...(targetNodeId ? { targetNodeId } : {}),
        },
      })
      requestIdRef.current = null
      setText('')
    } catch (cause) {
      queryClient.setQueryData<SupervisorMessagesResponse>(messagesKey, (previous) =>
        previous
          ? {
              ...previous,
              messages: previous.messages.filter((message) => message.id !== optimisticId),
            }
          : previous,
      )
      useSupervisorStreamStore.getState().reset()
      setSendError(cause instanceof Error ? cause.message : '发送失败')
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    void submit()
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-separator p-3">
      <div className="flex flex-wrap items-center gap-2">
        {contextNodes.map((node) => {
          const label = contextLabel(node)
          return (
            <span
              key={node.id}
              className="flex items-center gap-1 rounded-md border border-separator bg-background py-0.5 pl-1 pr-0.5"
            >
              <Chip size="sm" variant="soft" color="default">
                {typeLabels[node.type]}
              </Chip>
              <span className="max-w-32 truncate text-xs text-muted">{label}</span>
              <button
                type="button"
                aria-label={`移除上下文 ${label}`}
                onClick={() => removeContextNode(node.id)}
                className={`rounded p-0.5 text-muted hover:text-foreground ${FOCUS_RING}`}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          )
        })}
        {targetAgent ? (
          <Chip size="sm" variant="soft" color="accent">
            目标 {targetAgent.title}
          </Chip>
        ) : (
          <span className="text-xs text-muted">未选目标 Agent</span>
        )}
        {contextNodes.length > 0 ? (
          <button
            type="button"
            onClick={clearContext}
            className={`text-xs text-muted underline-offset-2 hover:text-foreground hover:underline ${FOCUS_RING}`}
          >
            清空上下文
          </button>
        ) : null}
      </div>
      <TextArea
        aria-label="对总管说"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        maxLength={8000}
        rows={3}
        fullWidth
      />
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted">
          {busy ? '总管正在处理上一条' : '总管只建待办，不会自动开工。'}
        </p>
        <Button
          variant="primary"
          aria-label="发送"
          isDisabled={busy || !text.trim()}
          onPress={() => void submit()}
        >
          发送
        </Button>
      </div>
      {sendError ? (
        <p role="alert" className="text-xs text-danger">
          {sendError}
        </p>
      ) : null}
    </div>
  )
}
