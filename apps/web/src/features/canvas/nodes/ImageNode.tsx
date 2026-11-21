import { useEffect, useState } from 'react'
import { NodeShell, type CanvasFlowNodeProps } from './NodeShell'

export function ImageNode({ data, selected }: CanvasFlowNodeProps) {
  const [broken, setBroken] = useState(false)
  const image = data.node.type === 'image' ? data.node.data : null
  const src = data.imageUrl

  // 同一节点换图后要重新尝试加载，不能沿用上一张图的失败状态。
  useEffect(() => setBroken(false), [src])

  if (!image) return null

  return (
    <NodeShell selected={selected} dimmed={data.dimmed}>
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-xs text-muted">{image.alt || '图片'}</p>
        <span className="shrink-0 text-[10px] text-muted">图片</span>
      </div>
      {broken || !src ? (
        <div className="mt-2 flex min-h-0 flex-1 items-center justify-center rounded border border-dashed border-separator text-xs text-muted">
          图片无法加载
        </div>
      ) : (
        <img
          src={src}
          alt={image.alt || '图片'}
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          className="mt-2 min-h-0 flex-1 rounded object-contain"
          onError={() => setBroken(true)}
        />
      )}
    </NodeShell>
  )
}
