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
import { NodePicker } from '../shared/NodePicker'
import { createRequestId, type SupervisorTargetAgent } from './supervisor-model'
import { useSupervisorStream, useSupervisorStreamStore } from './stream-store'

const typeLabels: Record<ProtocolNode['type'], string> = {
  text: '文本',
  file: '文件',
  agent: 'Agent',
  image: '图片',
  review: '验收',
  group: '分组',
  artifact: '产物',
  drawing: '画板',
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
  mobile = false,
  nodes = [],
}: {
  workspaceId: string
  contextNodes: ProtocolNode[]
  targetAgent: SupervisorTargetAgent | null
  initialText?: string
  initialTextKey?: number
  mobile?: boolean
  nodes?: ProtocolNode[]
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const removeContextNode = useAppStore((state) => state.removeContextNode)
  const clearContext = useAppStore((state) => state.clearContext)
  const stream = useSupervisorStream()
  const [text, setText] = useState(initialText)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [pickedTarget, setPickedTarget] = useState<SupervisorTargetAgent | null>(null)
  const [pickedContext, setPickedContext] = useState<ProtocolNode[] | null>(null)
  const [picker, setPicker] = useState<'target' | 'context' | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const busy = sending || stream.status === 'streaming'
  const effectiveTarget = pickedTarget ?? targetAgent
  const effectiveContext = pickedContext ?? contextNodes

  useEffect(() => {
    setPickedTarget(null)
    setPickedContext(null)
    setPicker(null)
  }, [workspaceId])

  useEffect(() => {
    // 同一个快捷提示可能被再次选中；用 key 让写入生效，而不是依赖文本变化。
    if (initialText) setText(initialText)
  }, [initialText, initialTextKey])

  const removeContext = (id: string) => {
    if (pickedContext) {
      setPickedContext(pickedContext.filter((node) => node.id !== id))
      return
    }
    removeContextNode(id)
  }

  const clear = () => {
    if (pickedContext) {
      setPickedContext([])
      return
    }
    clearContext()
  }

  const submit = async () => {
    const value = text.trim()
    if (!value || busy) return
    setSending(true)
    setSendError(null)
    // 发送失败时保留同一个 requestId，重试由服务端幂等去重，不会重复建任务。
    const requestId = (requestIdRef.current ??= createRequestId())
    const contextNodeIds = effectiveContext.map((node) => node.id)
    const targetNodeId = effectiveTarget?.id
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
      {mobile ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="tertiary" onPress={() => setPicker('target')}>
            目标 Agent {effectiveTarget?.title ?? '未选'}
          </Button>
          <Button size="sm" variant="tertiary" onPress={() => setPicker('context')}>
            上下文 {effectiveContext.length} 个
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {effectiveContext.map((node) => {
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
                onClick={() => removeContext(node.id)}
                className={`rounded p-0.5 text-muted hover:text-foreground ${FOCUS_RING}`}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          )
        })}
        {effectiveTarget ? (
          <Chip size="sm" variant="soft" color="accent">
            目标 {effectiveTarget.title}
          </Chip>
        ) : (
          <span className="text-xs text-muted">未选目标 Agent</span>
        )}
        {effectiveContext.length > 0 ? (
          <button
            type="button"
            onClick={clear}
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
          {busy ? '总管正在处理上一条' : '总管可建节点、派活并开工；验收仍由你决定。'}
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

      <NodePicker
        open={picker === 'target'}
        onOpenChange={(open) => setPicker(open ? 'target' : null)}
        nodes={nodes.filter((node) => node.type === 'agent')}
        mode="single"
        value={effectiveTarget ? [effectiveTarget.id] : []}
        onChange={(ids) => {
          const node = nodes.find((item) => item.id === ids[0])
          setPickedTarget(node?.type === 'agent' ? { id: node.id, title: node.data.title } : null)
        }}
        title="选择目标 Agent"
      />
      <NodePicker
        open={picker === 'context'}
        onOpenChange={(open) => setPicker(open ? 'context' : null)}
        nodes={nodes}
        mode="multi"
        value={effectiveContext.map((node) => node.id)}
        onChange={(ids) => setPickedContext(nodes.filter((node) => ids.includes(node.id)))}
        excludeIds={effectiveTarget ? [effectiveTarget.id] : []}
        title="选择上下文"
      />
    </div>
  )
}
