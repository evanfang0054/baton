import type { Engine, Node } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { TextArea } from '@heroui/react/textarea'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useCommand } from '../../lib/command-context'
import { nodeTitle } from './node-title'

type Draft =
  | { type: 'text'; node?: Node; content: string }
  | { type: 'file'; node?: Node; name: string; path: string }
  | { type: 'agent'; node?: Node; title: string; engine: Engine }

const TYPE_LABELS: Record<string, string> = { text: '文本', file: '文件', agent: 'Agent' }

export function MobileNodeManager({
  canvasId,
  nodes,
  onClose,
}: {
  canvasId: string
  nodes: Node[]
  onClose: () => void
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return nodes.filter((node) => {
      if (!['text', 'file', 'agent'].includes(node.type)) return false
      return !keyword || nodeTitle(node).toLowerCase().includes(keyword)
    })
  }, [nodes, search])

  const edit = (node: Node) => {
    if (node.type === 'text') setDraft({ type: 'text', node, content: node.data.content })
    if (node.type === 'file') {
      setDraft({ type: 'file', node, name: node.data.name, path: node.data.path })
    }
    if (node.type === 'agent') {
      setDraft({ type: 'agent', node, title: node.data.title, engine: node.data.engine })
    }
  }

  const save = async () => {
    if (!draft) return
    setPending(true)
    setError(null)
    try {
      if (draft.node) {
        const data =
          draft.type === 'text'
            ? { content: draft.content }
            : draft.type === 'file'
              ? { name: draft.name, path: draft.path }
              : { title: draft.title }
        await send({ type: 'node.update', payload: { nodeId: draft.node.id, patch: { data } } })
      } else {
        const index = nodes.length
        const position = {
          x: 80 + (index % 4) * 360,
          y: 80 + Math.floor(index / 4) * 240,
          w: 320,
          h: 200,
          groupId: null,
        }
        const node =
          draft.type === 'text'
            ? { type: 'text' as const, ...position, data: { content: draft.content } }
            : draft.type === 'file'
              ? {
                  type: 'file' as const,
                  ...position,
                  data: { name: draft.name, path: draft.path },
                }
              : {
                  type: 'agent' as const,
                  ...position,
                  data: { title: draft.title, engine: draft.engine, taskId: null },
                }
        await send({ type: 'node.create', payload: { canvasId, node } })
      }
      await queryClient.invalidateQueries({ queryKey: ['canvas'] })
      setDraft(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-separator px-3">
        <button type="button" onClick={onClose} className="text-sm text-muted">
          关闭
        </button>
        <h2 className="text-sm font-medium">节点</h2>
        <span className="w-10" />
      </header>

      {draft ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <h3 className="mb-3 text-sm font-medium">
            {draft.node ? '编辑' : '新建'}
            {TYPE_LABELS[draft.type]}
          </h3>
          <div className="flex flex-col gap-2">
            {draft.type === 'text' ? (
              <TextArea
                aria-label="文本内容"
                value={draft.content}
                onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                fullWidth
              />
            ) : null}
            {draft.type === 'file' ? (
              <>
                <Input
                  aria-label="文件名称"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  fullWidth
                />
                <Input
                  aria-label="相对路径"
                  value={draft.path}
                  onChange={(event) => setDraft({ ...draft, path: event.target.value })}
                  fullWidth
                />
              </>
            ) : null}
            {draft.type === 'agent' ? (
              <>
                <Input
                  aria-label="Agent 标题"
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  fullWidth
                />
                {!draft.node ? (
                  <select
                    aria-label="Agent 引擎"
                    value={draft.engine}
                    onChange={(event) =>
                      setDraft({ ...draft, engine: event.target.value as Engine })
                    }
                    className="h-10 rounded-lg border border-separator bg-background px-2 text-sm"
                  >
                    <option value="fake">fake</option>
                    <option value="claude-sdk">claude-sdk</option>
                  </select>
                ) : null}
              </>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button variant="tertiary" onPress={() => setDraft(null)} className="flex-1">
                返回
              </Button>
              <Button
                variant="primary"
                isDisabled={pending}
                onPress={() => void save()}
                className="flex-1"
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="shrink-0 p-3">
            <Input
              aria-label="搜索节点"
              placeholder="搜索节点"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              fullWidth
            />
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onPress={() => setDraft({ type: 'text', content: '' })}
              >
                新建文本
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => setDraft({ type: 'file', name: '', path: '' })}
              >
                新建文件
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => setDraft({ type: 'agent', title: '', engine: 'fake' })}
              >
                新建 Agent
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-24">
            {filtered.length === 0 ? <p className="text-sm text-muted">没有节点</p> : null}
            {filtered.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => edit(node)}
                className="mb-2 flex min-h-11 w-full items-center justify-between rounded-lg border border-separator px-3 text-left"
              >
                <span className="min-w-0 truncate text-sm">{nodeTitle(node)}</span>
                <span className="shrink-0 text-xs text-muted">{TYPE_LABELS[node.type]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
