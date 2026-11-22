import type { Artifact } from '@baton/protocol'
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { artifactContentUrl, fetchArtifactText } from '../../lib/api'
import { Overlay } from './Overlay'

function isImage(artifact: Artifact): boolean {
  return artifact.mime?.startsWith('image/') ?? false
}

function MarkdownView({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-6 text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

export function ArtifactViewerOverlay({
  deliveryId,
  artifact,
  onClose,
}: {
  deliveryId: string
  artifact: Artifact
  onClose: () => void
}) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isMarkdown = artifact.mime === 'text/markdown' || artifact.name.endsWith('.md')
  const isHtml = artifact.mime === 'text/html' || artifact.name.endsWith('.html')
  const isPdf = artifact.mime === 'application/pdf' || artifact.name.endsWith('.pdf')
  const url = artifactContentUrl(deliveryId, artifact.id)

  useEffect(() => {
    if (!artifact.mime?.startsWith('text/') || isHtml) return
    let cancelled = false
    fetchArtifactText(deliveryId, artifact.id)
      .then((value) => {
        if (!cancelled) setText(value)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '读取产物失败')
      })
    return () => {
      cancelled = true
    }
  }, [artifact.id, artifact.mime, deliveryId, isHtml])

  return (
    <Overlay title={`产物 · ${artifact.name}`} onClose={onClose} width="min(1080px, 96vw)">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>{artifact.kind}</span>
        <span>{artifact.status}</span>
        <span className="font-mono">{artifact.path}</span>
        <a className="underline underline-offset-2" href={url} download={artifact.name}>
          下载
        </a>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {isMarkdown ? (
        text === null ? (
          <p className="text-sm text-muted">正在加载…</p>
        ) : (
          <MarkdownView text={text} />
        )
      ) : isImage(artifact) ? (
        <img
          src={url}
          alt={artifact.name}
          className="mx-auto max-h-[70vh] max-w-full rounded-lg border border-separator object-contain"
        />
      ) : isHtml ? (
        <iframe
          title={artifact.name}
          src={url}
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          referrerPolicy="no-referrer"
          className="h-[70vh] w-full rounded-lg border border-separator bg-white"
        />
      ) : isPdf ? (
        <embed src={url} type="application/pdf" className="h-[70vh] w-full rounded-lg" />
      ) : (
        <pre className="max-h-[70vh] overflow-auto rounded-lg border border-separator bg-surface p-3 font-mono text-xs text-muted">
          {text ?? '该类型不支持预览，请下载查看。'}
        </pre>
      )}
    </Overlay>
  )
}
