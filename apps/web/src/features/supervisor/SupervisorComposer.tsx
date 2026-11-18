import type { Node as ProtocolNode } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { TextArea } from '@heroui/react/textarea'
import { X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useCommand } from '../../lib/command-context'
import { useAppStore } from '../../stores/app'
import { nodeTitle } from '../canvas/node-title'
import { createRequestId, type SupervisorTargetAgent } from './supervisor-model'
import { useSupervisorStream } from './stream-store'

const typeLabels: Record<ProtocolNode['type'], string> = {
  text: '文本',
  file: '文件',
  agent: 'Agent',
  image: '图片',
  review: '验收',
  group: '分组',
}

function contextLabel(node: ProtocolNode): string {
  const explicit = (node as ProtocolNode & { title?: unknown }).title
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
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
}: {
  workspaceId: string
  contextNodes: ProtocolNode[]
  targetAgent: SupervisorTargetAgent | null
  initialText?: string
}) {
  const send = useCommand()
  const removeContextNode = useAppStore((state) => state.removeContextNode)
  const clearContext = useAppStore((state) => state.clearContext)
  const stream = useSupervisorStream()
  const [text, setText] = useState(initialText)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const busy = sending || stream.status === 'streaming'

  useEffect(() => {
    if (initialText) setText(initialText)
  }, [initialText])

  const submit = async () => {
    const value = text.trim()
    if (!value || busy) return
    setSending(true)
    setSendError(null)
    // 发送失败时保留同一个 requestId，重试由服务端幂等去重，不会重复建任务。
    requestIdRef.current ??= createRequestId()
    try {
      await send({
        type: 'supervisor.send',
        payload: {
          workspaceId,
          requestId: requestIdRef.current,
          text: value,
          contextNodeIds: contextNodes.map((node) => node.id),
          ...(targetAgent ? { targetNodeId: targetAgent.id } : {}),
        },
      })
      requestIdRef.current = null
      setText('')
    } catch (cause) {
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
                className="rounded p-0.5 text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
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
            className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-accent"
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
