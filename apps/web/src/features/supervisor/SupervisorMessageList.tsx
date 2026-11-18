import type { SupervisorMessage as SupervisorMessageRecord } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Loader2 } from 'lucide-react'
import { SupervisorEmptyState } from './SupervisorEmptyState'
import { SupervisorMessage } from './SupervisorMessage'
import { SupervisorToolCard } from './SupervisorToolCard'
import type { SupervisorStreamProjection } from './supervisor-model'

function StreamingMessage({ stream }: { stream: SupervisorStreamProjection }) {
  return (
    <article className="flex gap-3" data-testid="supervisor-streaming">
      <span className="w-9 shrink-0 pt-0.5 text-xs text-muted">总管</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {stream.text ? (
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{stream.text}</p>
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
  canLoadOlder,
  loadingOlder,
  onLoadOlder,
  onRetry,
  onPickQuickPrompt,
}: {
  messages: SupervisorMessageRecord[]
  stream: SupervisorStreamProjection
  canLoadOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  onRetry: (message: SupervisorMessageRecord) => void
  onPickQuickPrompt: (text: string) => void
}) {
  return (
    <div
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
      {stream.status === 'streaming' ? <StreamingMessage stream={stream} /> : null}
    </div>
  )
}
