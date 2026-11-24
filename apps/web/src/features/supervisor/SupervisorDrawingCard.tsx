import type { SupervisorDrawingCard as SupervisorDrawingCardData } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { useState } from 'react'
import { artifactContentUrl } from '../../lib/api'

export function SupervisorDrawingCard({
  card,
  onOpen,
}: {
  card: SupervisorDrawingCardData
  onOpen?: (deliveryId: string, artifactId: string) => void
}) {
  const [previewFailed, setPreviewFailed] = useState(false)
  return (
    <section
      aria-label={`画板 ${card.title}`}
      className="rounded-lg border border-separator bg-background p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-sm font-medium text-foreground">{card.title}</h3>
        <Chip size="sm" variant="soft" color="default">
          画板
        </Chip>
      </div>
      {previewFailed ? (
        <div className="mt-2 flex h-24 items-center justify-center rounded-md border border-dashed border-separator text-xs text-muted">
          预览生成中
        </div>
      ) : (
        <img
          src={artifactContentUrl(card.deliveryId, card.artifactId, 'preview')}
          alt={`${card.title} 缩略图`}
          onError={() => setPreviewFailed(true)}
          className="mt-2 max-h-40 w-full rounded-md border border-separator object-contain"
        />
      )}
      <p className="mt-2 text-xs text-muted">
        元素 {card.elements} 个 · 文字 {card.texts} 段{card.previewStale ? ' · 预览生成中' : ''}
      </p>
      {onOpen ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-2"
          onPress={() => onOpen(card.deliveryId, card.artifactId)}
        >
          打开画板
        </Button>
      ) : null}
    </section>
  )
}
