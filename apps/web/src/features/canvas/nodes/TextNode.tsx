import { Type } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useCanvasActions } from '../actions'
import { NodeShell, type CanvasFlowNodeProps } from './NodeShell'

export function TextNode({ id, data, selected }: CanvasFlowNodeProps) {
  const content = data.node.type === 'text' ? data.node.data.content : ''
  const actions = useCanvasActions()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content)
  const cancelled = useRef(false)

  // 右侧面板或服务端刷新内容时同步折叠态；编辑中不打断用户输入。
  useEffect(() => {
    if (!editing) setDraft(content)
  }, [content, editing])

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    if (draft !== content) actions.updateContent(id, draft)
    setEditing(false)
  }

  return (
    <NodeShell selected={selected}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <Type size={14} />
        <span>文本</span>
        {!editing ? (
          <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
            双击编辑
          </span>
        ) : null}
      </div>
      {editing ? (
        <textarea
          aria-label="文本节点内容"
          className="nodrag nowheel mt-2 min-h-0 flex-1 resize-none rounded border border-separator bg-background p-2 font-mono text-xs text-foreground outline-none focus:border-accent"
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelled.current = true
              setDraft(content)
              setEditing(false)
            } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              commit()
            }
          }}
        />
      ) : (
        <p
          className="mt-2 line-clamp-4 cursor-text text-sm whitespace-pre-wrap text-foreground"
          title="双击编辑"
          onDoubleClick={(event) => {
            event.stopPropagation()
            setDraft(content)
            setEditing(true)
          }}
        >
          {content || <span className="text-muted">双击编辑…</span>}
        </p>
      )}
    </NodeShell>
  )
}
