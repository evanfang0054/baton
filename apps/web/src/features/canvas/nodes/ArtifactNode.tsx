import { FileText } from 'lucide-react'
import { NodeShell, type CanvasFlowNodeProps } from './NodeShell'

export function ArtifactNode({ data, selected }: CanvasFlowNodeProps) {
  const node = data.node.type === 'artifact' ? data.node : null
  const artifact = data.artifact
  return (
    <NodeShell selected={selected} injected={data.injected}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <FileText size={14} />
        产物
        <span className="rounded bg-default px-1.5 py-0.5 text-[10px] text-foreground">
          {artifact?.status ?? node?.data.status ?? 'draft'}
        </span>
      </div>
      <p className="mt-2 truncate text-sm font-medium text-foreground">
        {artifact?.name ?? node?.data.title ?? ''}
      </p>
      <p className="mt-1 truncate font-mono text-xs text-muted">
        {artifact?.path ?? node?.data.path ?? ''}
      </p>
      <p className="mt-1 text-[10px] text-muted">双击打开产物</p>
    </NodeShell>
  )
}
