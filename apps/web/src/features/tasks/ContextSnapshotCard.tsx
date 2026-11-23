import type { ContextSnapshot, DropReason, NodeType } from '@baton/protocol'

const reasonLabels: Record<DropReason, string> = {
  budget: '超出上下文预算',
  sensitive: '敏感文件已排除',
  limit: '超出节点上限',
  not_found: '节点已不存在',
  target: '目标 Agent 本身',
  empty: '内容为空',
}

const typeLabels: Record<NodeType, string> = {
  text: '文本',
  file: '文件',
  image: '图片',
  agent: 'Agent',
  review: '验收',
  group: '分组',
}

function relationBadge(
  relation: ContextSnapshot['relations'][number],
  targetNodeId: string | null | undefined,
): string {
  if (!targetNodeId) {
    if (relation.includedFrom && relation.includedTo) return '两端注入'
    if (relation.includedFrom || relation.includedTo) return '仅一端注入'
    return '仅关系'
  }
  if (relation.from === targetNodeId || relation.to === targetNodeId) return '目标'
  if (relation.includedFrom && relation.includedTo) return '两端注入'
  if (relation.includedFrom || relation.includedTo) return '仅一端注入'
  return '仅关系'
}

export function ContextSnapshotCard({
  snapshot,
  invalid = false,
  targetNodeId = null,
}: {
  snapshot: ContextSnapshot | null
  invalid?: boolean
  targetNodeId?: string | null
}) {
  if (!snapshot) {
    return (
      <section className="rounded-lg border border-separator bg-background p-3">
        <h3 className="text-sm font-medium">上下文快照</h3>
        <p className="mt-1 text-xs text-muted">
          {invalid
            ? '上下文快照不可用，任务其余信息不受影响'
            : '该任务创建于上下文快照上线前，未记录'}
        </p>
      </section>
    )
  }

  const totalChars = snapshot.included.reduce((sum, item) => sum + item.chars, 0)

  return (
    <section className="rounded-lg border border-separator bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">上下文快照</h3>
        {snapshot.relationsTruncated ? (
          <span className="text-xs text-warning">关系已截断</span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted">
        注入 {snapshot.included.length} 个 · 排除 {snapshot.dropped.length} 个 · {totalChars} 字符
        {snapshot.truncated ? ' · 内容已截断' : ''}
      </p>

      <ul className="mt-2 flex flex-col gap-1 text-xs">
        {snapshot.included.map((item) => (
          <li key={item.id} className="flex justify-between gap-2">
            <span>{item.title}</span>
            <span className="text-muted">
              {typeLabels[item.type]} · {item.chars} 字 · 深度 {item.depth}
            </span>
          </li>
        ))}
      </ul>

      {snapshot.dropped.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {snapshot.dropped.map((item) => (
            <li key={item.id} className="flex justify-between gap-2 text-muted">
              <span>{item.title ?? item.id}</span>
              <span>{reasonLabels[item.reason]}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {snapshot.relations.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {snapshot.relations.map((relation) => (
            <li
              key={`${relation.from}-${relation.to}-${relation.type}`}
              className="flex justify-between gap-2"
            >
              <span>
                {relation.fromTitle} → {relation.toTitle}
              </span>
              <span className="text-muted">{relationBadge(relation, targetNodeId)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {snapshot.redactedPaths.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
          {snapshot.redactedPaths.map((path) => (
            <li key={path}>已排除敏感文件：{path}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
