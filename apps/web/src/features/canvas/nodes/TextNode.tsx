import { Type } from 'lucide-react'
import { NodeShell, type CanvasFlowNodeProps } from './NodeShell'

export function TextNode({ data, selected }: CanvasFlowNodeProps) {
  const content = data.node.type === 'text' ? data.node.data.content : ''
  return (
    <NodeShell selected={selected}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <Type size={14} />
        文本
      </div>
      <p className="mt-2 line-clamp-4 text-sm whitespace-pre-wrap text-foreground">{content}</p>
    </NodeShell>
  )
}
