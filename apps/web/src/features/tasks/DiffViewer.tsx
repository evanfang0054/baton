import type { DiffFile, DiffSnapshot } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Modal } from '@heroui/react/modal'
import { useQuery } from '@tanstack/react-query'
import { ApiError, getReviewDiff } from '../../lib/api'
import { queryKeys } from '../../lib/query'

const MAX_RENDER_LINES = 2000

const statusLabels: Record<DiffFile['status'], string> = {
  modified: '修改',
  added: '新增',
  deleted: '删除',
  renamed: '重命名',
  binary: '二进制',
}

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-muted'
  if (line.startsWith('@@')) return 'text-accent'
  if (line.startsWith('+')) return 'text-success'
  if (line.startsWith('-')) return 'text-danger'
  return 'text-foreground'
}

function DiffFileView({ file }: { file: DiffFile }) {
  const lines = file.patch ? file.patch.split('\n') : []
  const rendered = lines.slice(0, MAX_RENDER_LINES)
  return (
    <details open className="mb-2 rounded-lg border border-separator">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-2 text-xs">
        <span className="font-mono text-foreground">
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        <span className="text-muted">{statusLabels[file.status]}</span>
        <span className="text-success">+{file.insertions}</span>
        <span className="text-danger">-{file.deletions}</span>
      </summary>
      {file.status === 'binary' ? (
        <p className="border-t border-separator p-2 text-xs text-muted">
          二进制文件，无文本 diff。
        </p>
      ) : lines.length === 0 ? (
        <p className="border-t border-separator p-2 text-xs text-muted">没有文本改动。</p>
      ) : (
        <pre className="overflow-x-auto border-t border-separator bg-background p-2 font-mono text-xs">
          {rendered.map((line, index) => (
            <div key={index} className={lineClass(line)}>
              {line || ' '}
            </div>
          ))}
          {lines.length > MAX_RENDER_LINES ? (
            <div className="text-muted">… 其余 {lines.length - MAX_RENDER_LINES} 行未渲染</div>
          ) : null}
        </pre>
      )}
    </details>
  )
}

function DiffContent({ snapshot }: { snapshot: DiffSnapshot }) {
  if (snapshot.files.length === 0) {
    return <p className="text-sm text-muted">没有改动。</p>
  }
  return (
    <>
      {snapshot.truncated ? (
        <p className="mb-2 rounded-lg border border-warning p-2 text-xs text-warning">
          diff 过大，已截断。
        </p>
      ) : null}
      {snapshot.files.map((file) => (
        <DiffFileView key={`${file.oldPath ?? ''}:${file.path}`} file={file} />
      ))}
    </>
  )
}

export function DiffViewer({ reviewId, onClose }: { reviewId: string; onClose: () => void }) {
  const query = useQuery({
    queryKey: queryKeys.reviewDiff(reviewId),
    queryFn: () => getReviewDiff(reviewId),
    staleTime: Infinity,
  })

  const errorCode = query.error instanceof ApiError ? query.error.code : null

  const dialogClass = [
    'flex h-[100dvh] w-screen max-w-none flex-col rounded-none p-0',
    'border border-separator bg-surface shadow-overlay',
    'md:h-auto md:max-h-[90vh] md:w-full md:max-w-3xl md:rounded-lg',
  ].join(' ')

  return (
    <Modal isOpen onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog aria-label="改动详情" className={dialogClass}>
            <Modal.Header className="flex items-center justify-between border-b border-separator p-3">
              <Modal.Heading className="text-sm font-medium">改动详情</Modal.Heading>
              <Button size="sm" variant="tertiary" onPress={onClose}>
                关闭
              </Button>
            </Modal.Header>
            <Modal.Body className="min-h-0 flex-1 overflow-y-auto p-3">
              {query.isLoading ? (
                <p className="text-sm text-muted">加载中…</p>
              ) : errorCode === 'diff_unavailable' ? (
                <p className="text-sm text-muted">该验收记录没有 diff 快照，仅保留统计。</p>
              ) : query.isError ? (
                <p role="alert" className="text-sm text-danger">
                  加载改动失败
                </p>
              ) : query.data ? (
                <DiffContent snapshot={query.data} />
              ) : null}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
