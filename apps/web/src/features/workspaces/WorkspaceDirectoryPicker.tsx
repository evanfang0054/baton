import type { WorkspaceBrowseEntry } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiError, browseWorkspaceDirectories } from '../../lib/api'
import { queryKeys } from '../../lib/query'

interface WorkspaceDirectoryPickerProps {
  onSelect: (entry: WorkspaceBrowseEntry) => void
}

const LIST_CLASS =
  'max-h-64 overflow-y-auto rounded-lg border border-separator bg-surface-secondary'

function crumbsFor(path: string): Array<{ label: string; path: string }> {
  const parts = path ? path.split('/') : []
  return [
    { label: '工作区根目录', path: '' },
    ...parts.map((part, index) => ({
      label: part,
      path: parts.slice(0, index + 1).join('/'),
    })),
  ]
}

export function WorkspaceDirectoryPicker({ onSelect }: WorkspaceDirectoryPickerProps) {
  const [path, setPath] = useState('')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  const searching = debouncedQuery.length > 0
  const searchPath = searching ? '' : path
  const browse = useQuery({
    queryKey: queryKeys.workspaceBrowse(searchPath, debouncedQuery),
    queryFn: () => browseWorkspaceDirectories({ path: searchPath, q: debouncedQuery }),
    staleTime: 5_000,
  })

  const data = browse.data
  const crumbs = crumbsFor(data?.path ?? searchPath)
  const browseError =
    browse.error instanceof ApiError && browse.error.code === 'invalid_path'
      ? '目录不存在或不可访问'
      : browse.error instanceof Error
        ? browse.error.message
        : null

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-separator bg-background p-3">
      <Input
        aria-label="搜索目录"
        placeholder="搜索目录名，如 baton"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        fullWidth
      />
      {searching ? (
        <p className="text-xs text-muted">在工作区根目录内搜索，结果可直接选择。</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
          {crumbs.map((crumb, index) => (
            <span key={crumb.path || 'root'} className="flex items-center gap-1">
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              <button
                type="button"
                className="rounded px-1 py-0.5 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => setPath(crumb.path)}
                aria-current={crumb.path === path ? 'page' : undefined}
              >
                {crumb.label}
              </button>
            </span>
          ))}
          {data?.parent !== null && data?.parent !== undefined ? (
            <Button
              size="sm"
              variant="tertiary"
              className="ml-auto"
              onPress={() => setPath(data.parent ?? '')}
            >
              上一级
            </Button>
          ) : null}
        </div>
      )}
      <div className={LIST_CLASS} aria-busy={browse.isFetching}>
        {browse.isPending ? <p className="p-3 text-sm text-muted">正在读取目录…</p> : null}
        {browse.error ? (
          <p role="alert" className="p-3 text-sm text-danger">
            {browseError}
          </p>
        ) : null}
        {!browse.isPending && !browse.error && data?.entries.length === 0 ? (
          <p className="p-3 text-sm text-muted">
            {searching ? '没有匹配的目录' : '此目录下没有可选择的子目录'}
          </p>
        ) : null}
        {data && data.entries.length > 0 ? (
          <ul className="divide-y divide-separator" aria-label={searching ? '搜索结果' : '子目录'}>
            {data.entries.map((entry) => (
              <li key={entry.relPath} className="flex items-center gap-2 p-1.5">
                <Button
                  size="sm"
                  variant="tertiary"
                  className="min-w-0 flex-1 justify-start"
                  aria-label={`选择目录 ${entry.relPath}`}
                  onPress={() => onSelect(entry)}
                >
                  <span className="truncate">{searching ? entry.relPath : entry.name}</span>
                  {entry.hasGit ? <span className="ml-2 text-xs text-muted">git</span> : null}
                </Button>
                {searching ? null : (
                  <Button
                    size="sm"
                    variant="tertiary"
                    aria-label={`进入 ${entry.name}`}
                    onPress={() => setPath(entry.relPath)}
                  >
                    进入
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {data?.truncated ? (
        <p className="text-xs text-warning">结果过多，只显示前一部分，请输入更精确的搜索词。</p>
      ) : null}
      <p className="text-xs text-muted">只能选择工作区根目录下的子目录；选择后自动填入名称。</p>
    </div>
  )
}
