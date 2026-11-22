import { PenLine } from 'lucide-react'
import { NodeShell, type CanvasFlowNodeProps } from './NodeShell'

export function DrawingNode({ data, selected }: CanvasFlowNodeProps) {
  const node = data.node.type === 'drawing' ? data.node : null
  return (
    <NodeShell selected={selected} injected={data.injected}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <PenLine size={14} />
        画板
      </div>
      <p className="mt-2 truncate text-sm font-medium text-foreground">{node?.data.title ?? ''}</p>
    </NodeShell>
  )
}
