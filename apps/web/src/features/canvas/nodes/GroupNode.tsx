import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react'
import { useCanvasActions } from '../actions'
import type { CanvasFlowNodeProps } from './NodeShell'

export function GroupNode({ data, selected }: CanvasFlowNodeProps) {
  const group = data.node.type === 'group' ? data.node.data : null
  const actions = useCanvasActions()
  if (!group) return null

  return (
    <div
      className={`flex h-full w-full flex-col rounded-xl border-2 border-dashed bg-surface/40 p-2 ${
        selected ? 'border-accent' : 'border-separator'
      } ${data.dimmed ? 'pointer-events-none opacity-25' : ''}`}
    >
      <div className="flex items-center gap-2 text-xs">
        <FolderOpen size={14} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{group.label}</span>
        <span className="shrink-0 text-muted">{data.childCount ?? 0} 个节点</span>
        <button
          type="button"
          className="nodrag inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={group.collapsed ? '展开分组' : '折叠分组'}
          onClick={() => actions.updateGroupCollapsed(data.node.id, !group.collapsed)}
        >
          {group.collapsed ? (
            <ChevronRight size={14} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} aria-hidden="true" />
          )}
          {group.collapsed ? '展开分组' : '折叠分组'}
        </button>
      </div>
    </div>
  )
}
