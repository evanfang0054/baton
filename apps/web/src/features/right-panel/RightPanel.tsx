import type { ReactNode } from 'react'

export function RightPanel({
  compact = false,
  collapsed = false,
  onToggleCollapsed,
  hasUnreadNotice = false,
  supervisor,
}: {
  compact?: boolean
  collapsed?: boolean
  onToggleCollapsed?: () => void
  hasUnreadNotice?: boolean
  supervisor: ReactNode
}) {
  if (collapsed) {
    return (
      <div
        className={
          compact
            ? 'absolute right-3 top-3 z-20'
            : 'flex w-12 shrink-0 flex-col items-center border-l border-separator bg-surface py-3'
        }
      >
        <button
          type="button"
          aria-label="展开总管"
          onClick={onToggleCollapsed}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-default hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span aria-hidden="true">总</span>
          {hasUnreadNotice ? (
            <span
              aria-hidden="true"
              className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent"
            />
          ) : null}
        </button>
      </div>
    )
  }

  return (
    <aside
      data-testid="right-panel"
      aria-label="精灵总管"
      className={
        compact
          ? 'absolute inset-y-0 right-0 z-20 flex min-h-0 w-[min(400px,92vw)] shrink-0 flex-col border-l border-separator bg-surface shadow-overlay'
          : 'flex min-h-0 w-[400px] shrink-0 flex-col border-l border-separator bg-surface'
      }
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-separator px-3 py-2">
        <span className="text-xs font-medium text-muted">精灵总管</span>
        {hasUnreadNotice ? (
          <span className="inline-flex items-center gap-1 text-xs text-accent">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
            有未读汇报
          </span>
        ) : null}
        <button
          type="button"
          aria-label="收起总管"
          onClick={onToggleCollapsed}
          className="ml-auto rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-default hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          收起
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{supervisor}</div>
    </aside>
  )
}
