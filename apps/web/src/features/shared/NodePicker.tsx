import type { Node } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { useEffect, useMemo, useState } from 'react'
import { nodeTitle } from '../canvas/node-title'

const TYPE_LABELS: Record<string, string> = {
  text: '文本',
  file: '文件',
  agent: 'Agent',
}

export function NodePicker({
  open,
  onOpenChange,
  nodes,
  mode,
  value,
  onChange,
  excludeIds = [],
  title,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  nodes: Node[]
  mode: 'single' | 'multi'
  value: string[]
  onChange: (ids: string[]) => void
  excludeIds?: string[]
  title: string
}) {
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<string[]>(value)

  useEffect(() => {
    if (!open) return
    setDraft(value)
    setSearch('')
  }, [open, value])

  const available = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return nodes.filter((node) => {
      if (!['text', 'file', 'agent'].includes(node.type)) return false
      if (excludeIds.includes(node.id)) return false
      if (!keyword) return true
      return nodeTitle(node).toLowerCase().includes(keyword)
    })
  }, [nodes, excludeIds, search])

  if (!open) return null

  const toggle = (id: string) => {
    if (mode === 'single') {
      setDraft([id])
      return
    }
    setDraft((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-separator px-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <button
          type="button"
          aria-label="关闭"
          onClick={() => onOpenChange(false)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-accent"
        >
          ×
        </button>
      </header>
      <div className="shrink-0 p-3">
        <Input
          aria-label="搜索节点"
          placeholder="搜索节点标题"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          fullWidth
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {available.length === 0 ? (
          <p className="p-3 text-sm text-muted">没有可选节点</p>
        ) : (
          <div className="flex flex-col gap-2">
            {available.map((node) => {
              const selected = draft.includes(node.id)
              return (
                <button
                  key={node.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle(node.id)}
                  className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left ${
                    selected ? 'border-accent bg-surface' : 'border-separator bg-background'
                  }`}
                >
                  <span className="min-w-0 truncate text-sm">{nodeTitle(node)}</span>
                  <span className="shrink-0 text-xs text-muted">{TYPE_LABELS[node.type]}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-separator p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button variant="tertiary" onPress={() => onOpenChange(false)}>
          取消
        </Button>
        <Button
          variant="primary"
          isDisabled={mode === 'single' ? draft.length !== 1 : draft.length === 0}
          onPress={() => {
            onChange(draft)
            onOpenChange(false)
          }}
        >
          确定
        </Button>
      </footer>
    </div>
  )
}
