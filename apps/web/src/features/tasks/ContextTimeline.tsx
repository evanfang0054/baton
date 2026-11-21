import type { ContextSnapshot } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { ContextSnapshotCard } from './ContextSnapshotCard'

export function ContextTimeline({
  snapshot,
  invalid = false,
  targetNodeId,
  knownNodeIds,
  onSelectNode,
}: {
  snapshot: ContextSnapshot | null
  invalid?: boolean
  targetNodeId?: string | null
  knownNodeIds?: ReadonlySet<string>
  onSelectNode?: (nodeId: string) => void
}) {
  return (
    <section className="flex flex-col gap-2">
      <ContextSnapshotCard snapshot={snapshot} invalid={invalid} targetNodeId={targetNodeId} />
      {(snapshot?.injections ?? []).map((injection) => (
        <section
          key={injection.seq}
          className="rounded-lg border border-separator bg-background p-3 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">注入 #{injection.seq}</h4>
            <span className="text-muted">
              {new Date(injection.at).toLocaleString()} ·{' '}
              {injection.source === 'supervisor' ? '总管' : '你'}
            </span>
          </div>
          {injection.note ? <p className="mt-1 text-muted">{injection.note}</p> : null}
          <ul className="mt-2 flex flex-wrap gap-1">
            {injection.included.map((item) => {
              const missing = knownNodeIds ? !knownNodeIds.has(item.id) : false
              return (
                <li key={item.id}>
                  <Button
                    size="sm"
                    variant="tertiary"
                    isDisabled={missing || !onSelectNode}
                    onPress={() => onSelectNode?.(item.id)}
                  >
                    {item.title}
                    {missing ? '（已删除）' : ''}
                  </Button>
                </li>
              )
            })}
          </ul>
          <p className="mt-1 text-muted">
            {injection.included.length} 个节点 · {injection.chars} 字
            {injection.truncated ? ' · 已截断' : ''}
            {injection.dropped.length > 0 ? ` · 排除 ${injection.dropped.length} 个` : ''}
          </p>
        </section>
      ))}
    </section>
  )
}
