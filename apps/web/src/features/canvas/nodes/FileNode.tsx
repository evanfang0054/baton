import { FileText } from 'lucide-react'
import { NodeShell, type CanvasFlowNodeProps } from './NodeShell'

export function FileNode({ data, selected }: CanvasFlowNodeProps) {
  const file = data.node.type === 'file' ? data.node.data : null
  return (
    <NodeShell selected={selected}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <FileText size={14} />
        文件
      </div>
      <p className="mt-2 truncate text-sm font-medium text-foreground">{file?.name ?? ''}</p>
      <p className="mt-1 truncate font-mono text-xs text-muted">{file?.path ?? ''}</p>
    </NodeShell>
  )
}
