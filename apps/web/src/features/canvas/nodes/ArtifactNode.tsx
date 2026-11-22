import { FileText } from 'lucide-react'
import { NodeShell, type CanvasFlowNodeProps } from './NodeShell'

export function ArtifactNode({ data, selected }: CanvasFlowNodeProps) {
  const node = data.node.type === 'artifact' ? data.node : null
  return (
    <NodeShell selected={selected} injected={data.injected}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <FileText size={14} />
        产物
      </div>
      <p className="mt-2 truncate text-sm font-medium text-foreground">{node?.data.title ?? ''}</p>
      <p className="mt-1 truncate font-mono text-xs text-muted">{node?.data.path ?? ''}</p>
    </NodeShell>
  )
}
