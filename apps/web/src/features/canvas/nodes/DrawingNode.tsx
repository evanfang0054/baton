import { PenLine } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NodeShell, type CanvasFlowNodeProps } from './NodeShell'

export function DrawingNode({ data, selected }: CanvasFlowNodeProps) {
  const node = data.node.type === 'drawing' ? data.node : null
  const previewUrl = data.previewUrl
  const [previewFailed, setPreviewFailed] = useState(false)

  useEffect(() => {
    setPreviewFailed(false)
  }, [previewUrl])

  return (
    <NodeShell selected={selected} injected={data.injected}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <PenLine size={14} aria-hidden="true" />
        画板
        <span className="rounded bg-default px-1.5 py-0.5 text-[10px] text-foreground">
          {node?.data.status ?? 'draft'}
        </span>
      </div>
      {previewUrl && !previewFailed ? (
        <img
          src={previewUrl}
          alt={`画板缩略图 ${node?.data.title ?? ''}`}
          onError={() => setPreviewFailed(true)}
          className="mt-2 h-[120px] w-full rounded-md border border-separator bg-surface object-contain"
        />
      ) : (
        <div className="mt-2 flex h-[120px] items-center justify-center rounded-md border border-dashed border-separator text-xs text-muted">
          暂无缩略图
        </div>
      )}
      <p className="mt-2 truncate text-sm font-medium text-foreground">{node?.data.title ?? ''}</p>
      <p className={`mt-1 text-[10px] ${node?.data.previewStale ? 'text-warning' : 'text-muted'}`}>
        {node?.data.previewStale ? '画板已更新，缩略图刷新中' : '双击编辑'}
      </p>
    </NodeShell>
  )
}
