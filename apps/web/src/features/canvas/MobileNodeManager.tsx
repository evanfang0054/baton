import type { Engine, Node } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { TextArea } from '@heroui/react/textarea'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { listEngines } from '../../lib/api'
import { useCommand } from '../../lib/command-context'
import { queryKeys } from '../../lib/query'
import { preferredEngine } from '../tasks/engine-preference'
import { nodeTitle } from './node-title'

type Draft =
  | { type: 'text'; node?: Node; content: string }
  | { type: 'file'; node?: Node; name: string; path: string; mime: string }
  | { type: 'agent'; node?: Node; title: string; engine: Engine }

const TYPE_LABELS: Record<'text' | 'file' | 'agent', string> = {
  text: '文本',
  file: '文件',
  agent: 'Agent',
}

const LIST_TYPES = ['text', 'file', 'agent'] as const

function relativePathError(path: string): string | null {
  if (!path) return '请填写相对路径'
  if (path.startsWith('/')) return '路径必须是相对路径'
  if (path.split('/').includes('..')) return '路径不能包含 ..'
  return null
}

function draftError(draft: Draft): string | null {
  if (draft.type === 'text') return null
  if (draft.type === 'file') {
    if (!draft.name.trim()) return '请填写文件名称'
    return relativePathError(draft.path.trim())
  }
  return draft.title.trim() ? null : '请填写 Agent 标题'
}

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
  const engines = useQuery({ queryKey: queryKeys.engines, queryFn: listEngines })
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const engineOptions = engines.data ?? []
  const defaultEngine = preferredEngine(engineOptions) ?? 'claude-sdk'
  const storedEngine = draft?.type === 'agent' ? draft.engine : null
  const effectiveEngine =
    storedEngine && engineOptions.some((entry) => entry.engine === storedEngine)
      ? storedEngine
      : defaultEngine
  const invalid = draft ? draftError(draft) : null
  const enginesBlocked =
    draft?.type === 'agent' &&
    !draft.node &&
    (engines.isLoading || engines.isError || engineOptions.length === 0)

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return nodes.filter((node) => {
      if (!LIST_TYPES.includes(node.type as (typeof LIST_TYPES)[number])) return false
      return !keyword || nodeTitle(node).toLowerCase().includes(keyword)
    })
  }, [nodes, search])

  const grouped = useMemo(
    () =>
      Object.fromEntries(
        LIST_TYPES.map((type) => [type, filtered.filter((node) => node.type === type)]),
      ) as Record<(typeof LIST_TYPES)[number], Node[]>,
    [filtered],
  )

  const edit = (node: Node) => {
    if (node.type === 'text') setDraft({ type: 'text', node, content: node.data.content })
    if (node.type === 'agent') {
      setDraft({ type: 'agent', node, title: node.data.title, engine: node.data.engine })
    }
  }

  const save = async () => {
    if (!draft) return
    const validationError = draftError(draft)
    if (validationError) {
      setError(validationError)
      return
    }
    setPending(true)
    setError(null)
    try {
      if (draft.node) {
        const data =
          draft.type === 'text'
            ? { content: draft.content }
            : draft.type === 'agent'
              ? { title: draft.title.trim() }
              : null
        if (!data) {
          setDraft(null)
          return
        }
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
                  data: {
                    name: draft.name.trim(),
                    path: draft.path.trim(),
                    ...(draft.mime.trim() ? { mime: draft.mime.trim() } : {}),
                  },
                }
              : {
                  type: 'agent' as const,
                  ...position,
                  data: { title: draft.title.trim(), engine: effectiveEngine, taskId: null },
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
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-11 min-w-11 items-center justify-center rounded-md text-sm text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          关闭
        </button>
        <h2 className="text-sm font-medium">节点</h2>
        <span className="w-11" />
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
                  placeholder="文件名称"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  fullWidth
                />
                <Input
                  aria-label="相对路径"
                  placeholder="src/example.ts"
                  value={draft.path}
                  onChange={(event) => setDraft({ ...draft, path: event.target.value })}
                  fullWidth
                />
                <Input
                  aria-label="MIME 类型（可选）"
                  placeholder="text/plain"
                  value={draft.mime}
                  onChange={(event) => setDraft({ ...draft, mime: event.target.value })}
                  fullWidth
                />
                <p className="text-xs text-muted">路径必须相对于项目根目录，且不能包含 ..</p>
              </>
            ) : null}
            {draft.type === 'agent' ? (
              <>
                <Input
                  aria-label="Agent 标题"
                  placeholder="Agent 标题"
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  fullWidth
                />
                {!draft.node ? (
                  <select
                    aria-label="Agent 引擎"
                    value={effectiveEngine}
                    onChange={(event) =>
                      setDraft({ ...draft, engine: event.target.value as Engine })
                    }
                    className="h-11 rounded-lg border border-separator bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {engineOptions.length === 0 ? (
                      <option value={effectiveEngine}>加载中…</option>
                    ) : null}
                    {engineOptions.map((entry) => (
                      <option
                        key={entry.engine}
                        value={entry.engine}
                        disabled={entry.status === 'unavailable'}
                      >
                        {entry.engine}
                        {entry.status === 'unavailable' ? '（不可用）' : ''}
                      </option>
                    ))}
                  </select>
                ) : null}
                {engines.isError ? (
                  <p className="text-xs text-danger">引擎状态加载失败，请稍后重试</p>
                ) : null}
              </>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            {invalid && !error ? <p className="text-xs text-muted">{invalid}</p> : null}
            <div className="flex gap-2">
              <Button variant="tertiary" onPress={() => setDraft(null)} className="flex-1">
                返回
              </Button>
              <Button
                variant="primary"
                isDisabled={pending || Boolean(invalid) || enginesBlocked}
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
                onPress={() => setDraft({ type: 'file', name: '', path: '', mime: '' })}
              >
                新建文件
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => setDraft({ type: 'agent', title: '', engine: defaultEngine })}
              >
                新建 Agent
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(6rem+env(safe-area-inset-bottom))]">
            {filtered.length === 0 ? <p className="text-sm text-muted">没有节点</p> : null}
            {LIST_TYPES.map((type) => {
              const items = grouped[type]
              if (items.length === 0) return null
              return (
                <section key={type} className="mb-4">
                  <h3 className="mb-2 text-xs font-medium text-muted">
                    {TYPE_LABELS[type]} ({items.length})
                  </h3>
                  <div className="flex flex-col gap-2">
                    {items.map((node) =>
                      node.type === 'file' ? (
                        <div
                          key={node.id}
                          className="flex min-h-11 items-center justify-between rounded-lg border border-separator px-3 text-left"
                        >
                          <span className="min-w-0 truncate text-sm">{nodeTitle(node)}</span>
                          <span className="shrink-0 text-xs text-muted">只读</span>
                        </div>
                      ) : (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => edit(node)}
                          className="flex min-h-11 w-full items-center justify-between rounded-lg border border-separator px-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        >
                          <span className="min-w-0 truncate text-sm">{nodeTitle(node)}</span>
                          <span className="shrink-0 text-xs text-muted">{TYPE_LABELS[type]}</span>
                        </button>
                      ),
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
