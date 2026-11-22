import type { FailureSummary } from '@baton/protocol'

export function TaskFailureCard({ failure }: { failure: FailureSummary | null }) {
  if (!failure) return null
  return (
    <section
      aria-label="最近失败"
      className="shrink-0 rounded-lg border border-danger bg-danger/10 p-3"
    >
      <h3 className="text-xs font-medium text-danger">最近失败</h3>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-md bg-default px-2 py-0.5 text-foreground">{failure.stage}</span>
        <span className="rounded-md bg-default px-2 py-0.5 text-muted">
          {failure.retryable ? '可重试' : '不可重试'}
        </span>
      </div>
      <p className="mt-2 text-xs text-foreground">{failure.summary}</p>
      <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-muted">
        {failure.lastError}
      </p>
      {failure.affectedPaths.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted">
          {failure.affectedPaths.map((path) => (
            <li key={path} className="break-all font-mono">
              {path}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
