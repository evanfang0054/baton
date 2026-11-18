import type { SupervisorMessage as SupervisorMessageRecord } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SupervisorEmptyState } from './SupervisorEmptyState'
import { SupervisorMessage } from './SupervisorMessage'
import { SupervisorToolCard } from './SupervisorToolCard'
import type { SupervisorStreamProjection } from './supervisor-model'

function StreamingMessage({ stream }: { stream: SupervisorStreamProjection }) {
  const targetRef = useRef(stream.text)
  targetRef.current = stream.text
  const [visible, setVisible] = useState('')

  // 后端/模型可能一次到达一大段；按帧揭示，避免“整段闪现”。
  useEffect(() => {
    const timer = window.setInterval(() => {
      setVisible((current) => {
        const target = targetRef.current
        if (!target.startsWith(current)) return target
        if (current.length >= target.length) return current
        const remaining = target.length - current.length
        const step = Math.max(4, Math.ceil(remaining / 30))
        return target.slice(0, current.length + step)
      })
    }, 16)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setVisible('')
  }, [stream.messageId])

  return (
    <article className="flex gap-3" data-testid="supervisor-streaming" aria-live="off">
      <span className="w-9 shrink-0 pt-0.5 text-xs text-muted">总管</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {visible ? (
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">
            {visible}
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-accent align-middle motion-reduce:animate-none"
            />
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            总管正在思考…
          </p>
        )}
        {stream.tools.map((tool) => (
          <SupervisorToolCard key={tool.id} tool={tool} />
        ))}
      </div>
    </article>
  )
}

export function SupervisorMessageList({
  messages,
  stream,
  incomplete,
  canLoadOlder,
  loadingOlder,
  onLoadOlder,
  onRetry,
  onRetryIncomplete,
  onPickQuickPrompt,
}: {
  messages: SupervisorMessageRecord[]
  stream: SupervisorStreamProjection
  incomplete: SupervisorMessageRecord | null
  canLoadOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  onRetry: (message: SupervisorMessageRecord) => void
  onRetryIncomplete: () => void
  onPickQuickPrompt: (text: string) => void
}) {
  const logRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // 用户停在底部时跟随新消息/流式文本；主动上翻阅读历史时不抢滚动位置。
  useEffect(() => {
    const element = logRef.current
    if (element && stickToBottom.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [incomplete, messages.length, stream.status, stream.text, stream.tools.length])

  const onScroll = () => {
    const element = logRef.current
    if (!element) return
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
  }

  return (
    <div
      ref={logRef}
      onScroll={onScroll}
      role="log"
      aria-live="polite"
      aria-label="总管对话"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3"
    >
      {canLoadOlder ? (
        <div className="flex justify-center">
          <Button variant="tertiary" size="sm" isDisabled={loadingOlder} onPress={onLoadOlder}>
            {loadingOlder ? '加载中…' : '加载更早'}
          </Button>
        </div>
      ) : null}
      {messages.length === 0 && stream.status !== 'streaming' ? (
        <SupervisorEmptyState onPick={onPickQuickPrompt} />
      ) : null}
      {messages.map((message) => (
        <SupervisorMessage
          key={message.id}
          message={message}
          onRetry={message.status === 'error' ? () => onRetry(message) : undefined}
        />
      ))}
      {incomplete ? (
        <div role="status" className="rounded-lg border border-warning bg-warning/10 p-3">
          <p className="text-xs font-medium text-warning">上一条未完成</p>
          <p className="mt-1 text-xs text-muted">没有收到总管的回复。</p>
          <Button variant="tertiary" size="sm" className="mt-2" onPress={onRetryIncomplete}>
            重试
          </Button>
        </div>
      ) : null}
      {stream.status === 'streaming' ? <StreamingMessage stream={stream} /> : null}
    </div>
  )
}
