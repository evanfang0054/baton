import type { SessionEventRecord } from '@baton/protocol'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildTranscript, type TranscriptEntry, type TranscriptRole } from './transcript-model'

const roleLabels: Record<TranscriptRole, string> = {
  user: '你',
  assistant: 'Agent',
  tool: '工具',
  system: '系统',
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function formatTime(ts: number) {
  const date = new Date(ts)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function EntryView({ entry }: { entry: TranscriptEntry }) {
  const role = roleLabels[entry.role]
  return (
    <div className="flex gap-3 border-b border-separator/60 py-3">
      <span className="w-12 shrink-0 pt-0.5 text-xs text-muted">{role}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[10px] text-muted">
          {entry.title && entry.title !== role ? (
            <span className="font-medium text-foreground">{entry.title}</span>
          ) : null}
          <span>{formatTime(entry.ts)}</span>
        </div>
        {entry.text ? (
          entry.mono ? (
            <pre className="mt-1 overflow-x-auto rounded-lg border border-separator bg-background p-3 font-mono text-xs whitespace-pre-wrap text-foreground">
              {entry.text}
            </pre>
          ) : (
            <p className="mt-1 text-sm whitespace-pre-wrap text-foreground">{entry.text}</p>
          )
        ) : null}
      </div>
    </div>
  )
}

export function Transcript({
  events,
  loading = false,
  virtualize = true,
}: {
  events: SessionEventRecord[]
  loading?: boolean
  virtualize?: boolean
}) {
  const entries = useMemo(() => buildTranscript(events), [events])
  const parentRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const previousCount = useRef(entries.length)

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 8,
  })

  useEffect(() => {
    const grew = entries.length > previousCount.current
    previousCount.current = entries.length
    if (grew && atBottom && entries.length > 0) {
      virtualizer.scrollToIndex(entries.length - 1, { align: 'end' })
    }
  }, [entries.length, atBottom, virtualizer])

  if (loading) {
    return <p className="p-3 text-sm text-muted">加载中…</p>
  }

  if (entries.length === 0) {
    return <p className="p-3 text-sm text-muted">暂无会话记录</p>
  }

  const onScroll = () => {
    const element = parentRef.current
    if (!element) return
    setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 24)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={parentRef}
        onScroll={onScroll}
        aria-label="会话记录"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-3"
      >
        {virtualize ? (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const entry = entries[item.index]
              if (!entry) return null
              return (
                <div
                  key={entry.id}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <EntryView entry={entry} />
                </div>
              )
            })}
          </div>
        ) : (
          entries.map((entry) => <EntryView key={entry.id} entry={entry} />)
        )}
      </div>
      {!atBottom ? (
        <button
          type="button"
          onClick={() => {
            setAtBottom(true)
            virtualizer.scrollToIndex(entries.length - 1, { align: 'end' })
          }}
          className="absolute right-3 bottom-3 rounded-full border border-separator bg-surface px-3 py-1 text-xs text-foreground shadow-surface"
        >
          跳到最新
        </button>
      ) : null}
    </div>
  )
}
