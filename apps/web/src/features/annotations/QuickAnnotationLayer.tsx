import type { AnnotationSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { toast } from '@heroui/react/toast'
import { toPng } from 'html-to-image'
import { getStroke } from 'perfect-freehand'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createAnnotation, createWorkspaceAnnotation } from '../../lib/api'

export type QuickTool = 'pen' | 'highlight' | 'eraser' | 'text'

export interface QuickStroke {
  tool: Exclude<QuickTool, 'eraser' | 'text'>
  color: string
  size: number
  points: Array<[number, number]>
}

/** 画布上的文字注释；和笔画一起保存进 strokesJson，note 里保留纯文本给总管。 */
export interface QuickText {
  id: string
  x: number
  y: number
  text: string
  color: string
}

const TEXT_HEIGHT = 34
const FALLBACK_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3rWQAAAABJRU5ErkJggg=='

const COLORS = ['var(--accent)', 'var(--warning)', 'var(--danger)', 'var(--foreground)']

export function strokePath(points: Array<[number, number]>, size: number): string {
  const outline = getStroke(points, {
    size,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
  })
  if (outline.length === 0) return ''
  return `${outline
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')} Z`
}

export function pointsBBox(points: Array<[number, number]>, size: number) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  const pad = Math.max(8, size)
  const x = Math.max(0, Math.round(minX - pad))
  const y = Math.max(0, Math.round(minY - pad))
  return {
    x,
    y,
    w: Math.max(1, Math.round(maxX - minX + pad * 2)),
    h: Math.max(1, Math.round(maxY - minY + pad * 2)),
  }
}

function distanceToStroke(point: [number, number], stroke: QuickStroke): number {
  let best = Infinity
  for (const [x, y] of stroke.points) {
    best = Math.min(best, Math.hypot(point[0] - x, point[1] - y))
  }
  return best
}

export function textBBox(text: QuickText) {
  const width = Math.min(320, Math.max(160, text.text.trim().length * 14 + 24))
  return { x: Math.round(text.x), y: Math.round(text.y), w: width, h: TEXT_HEIGHT }
}

export function selectionBBox(strokes: QuickStroke[], texts: QuickText[]) {
  const points: Array<[number, number]> = strokes.flatMap((stroke) => stroke.points)
  for (const text of texts) {
    const box = textBBox(text)
    points.push([box.x, box.y], [box.x + box.w, box.y + box.h])
  }
  return points.length > 0 ? pointsBBox(points, 8) : { x: 0, y: 0, w: 1, h: 1 }
}

function hitsText(point: [number, number], text: QuickText): boolean {
  const box = textBBox(text)
  return (
    point[0] >= box.x - 4 &&
    point[0] <= box.x + box.w + 4 &&
    point[1] >= box.y - 4 &&
    point[1] <= box.y + box.h + 4
  )
}

type QuickAnnotationTarget =
  | { deliveryId: string; stageKey: string; workspaceId?: never }
  | { workspaceId: string; deliveryId?: never; stageKey?: never }

export function QuickAnnotationLayer({
  deliveryId,
  stageKey,
  workspaceId,
  annotations,
  onClose,
  onSaved,
}: QuickAnnotationTarget & {
  annotations: AnnotationSummary[]
  onClose: () => void
  onSaved: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [tool, setTool] = useState<QuickTool>('pen')
  const [color, setColor] = useState(COLORS[0]!)
  const [size, setSize] = useState(4)
  const [strokes, setStrokes] = useState<QuickStroke[]>([])
  const [draft, setDraft] = useState<QuickStroke | null>(null)
  const [texts, setTexts] = useState<QuickText[]>([])
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const drawing = useRef(false)
  const textSeq = useRef(0)

  const commitDraft = useCallback(() => {
    if (!draft || draft.points.length < 2) {
      setDraft(null)
      return
    }
    setStrokes((current) => [...current, draft])
    setDraft(null)
  }, [draft])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      if (event.key === 'Escape') onClose()
      if (event.key.toLowerCase() === 'p') setTool('pen')
      if (event.key.toLowerCase() === 'h') setTool('highlight')
      if (event.key.toLowerCase() === 't') setTool('text')
      if (event.key.toLowerCase() === 'e') setTool('eraser')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const position = (event: React.PointerEvent): [number, number] => {
    const rect = rootRef.current?.getBoundingClientRect()
    return [event.clientX - (rect?.left ?? 0), event.clientY - (rect?.top ?? 0)]
  }

  const onPointerDown = (event: React.PointerEvent) => {
    event.preventDefault()
    if (tool !== 'eraser' && strokes.length + texts.length >= 200) {
      toast.warning('单阶段最多 200 条标注')
      return
    }
    const point = position(event)
    if (tool === 'eraser') {
      setStrokes((current) =>
        current.filter((stroke) => distanceToStroke(point, stroke) > Math.max(12, stroke.size * 2)),
      )
      setTexts((current) => current.filter((text) => !hitsText(point, text)))
      setEditingTextId(null)
      return
    }
    if (tool === 'text') {
      const id = `text-${++textSeq.current}`
      setTexts((current) => [...current, { id, x: point[0], y: point[1], text: '', color }])
      setEditingTextId(id)
      return
    }
    drawing.current = true
    rootRef.current?.setPointerCapture(event.pointerId)
    setDraft({
      tool,
      color: tool === 'highlight' ? 'var(--warning)' : color,
      size: tool === 'highlight' ? Math.max(14, size * 3) : size,
      points: [point],
    })
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drawing.current) return
    const point = position(event)
    setDraft((current) => (current ? { ...current, points: [...current.points, point] } : current))
  }

  const onPointerUp = () => {
    if (!drawing.current) return
    drawing.current = false
    commitDraft()
  }

  const updateText = (id: string, text: string) => {
    setTexts((current) => current.map((item) => (item.id === id ? { ...item, text } : item)))
  }

  const finishText = (id: string) => {
    setEditingTextId(null)
    setTexts((current) => current.filter((item) => item.id !== id || item.text.trim().length > 0))
  }

  const bbox = useMemo(
    () =>
      selectionBBox(
        strokes,
        texts.filter((text) => text.text.trim().length > 0),
      ),
    [strokes, texts],
  )

  const save = async () => {
    const cleanedTexts = texts
      .map((text) => ({ ...text, text: text.text.trim() }))
      .filter((text) => text.text.length > 0)
    if (strokes.length === 0 && cleanedTexts.length === 0 && !note.trim()) {
      toast.warning('先画一笔或写一条文字备注')
      return
    }
    setEditingTextId(null)
    setSaving(true)
    let imageBase64 = FALLBACK_PNG
    try {
      const target = rootRef.current?.parentElement
      if (target) {
        const dataUrl = await toPng(target, { pixelRatio: 1 })
        imageBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      }
    } catch {
      imageBase64 = FALLBACK_PNG
    }
    const textNote = cleanedTexts.map((text) => text.text).join('；')
    const annotationNote = [textNote, note.trim()].filter(Boolean).join('；').slice(0, 2000)
    try {
      if (deliveryId) {
        await createAnnotation(deliveryId, {
          stageKey: stageKey!,
          targetNodeIds: [],
          note: annotationNote,
          strokesJson: JSON.stringify({ strokes, texts: cleanedTexts }),
          bbox,
          imageBase64,
        })
      } else {
        await createWorkspaceAnnotation(workspaceId!, {
          targetNodeIds: [],
          note: annotationNote,
          strokesJson: JSON.stringify({ strokes, texts: cleanedTexts }),
          bbox,
          imageBase64,
        })
      }
      onSaved()
      onClose()
    } catch (cause) {
      toast.danger(cause instanceof Error ? cause.message : '保存标注失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className={`absolute inset-0 z-30 touch-none ${tool === 'text' ? 'cursor-text' : 'cursor-crosshair'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="application"
      aria-label="快速标注层"
    >
      <div className="pointer-events-none absolute inset-0">
        {annotations
          .filter((annotation) => annotation.status === 'open')
          .map((annotation) => (
            <div
              key={annotation.id}
              className="absolute rounded border border-warning/60 bg-warning/10 p-1 text-[11px] leading-tight text-warning/90"
              style={{
                left: annotation.bbox.x,
                top: annotation.bbox.y,
                width: annotation.bbox.w,
                height: annotation.bbox.h,
              }}
              title={annotation.note}
            >
              {annotation.note ? <span className="line-clamp-2">{annotation.note}</span> : null}
            </div>
          ))}
        {texts.map((text) => {
          const box = textBBox(text)
          const editing = editingTextId === text.id
          return (
            <div
              key={text.id}
              className="absolute"
              style={{ left: box.x, top: box.y, width: box.w }}
            >
              {editing ? (
                <input
                  autoFocus
                  aria-label="文字标注"
                  value={text.text}
                  maxLength={2000}
                  placeholder="写备注，回车确认"
                  className="pointer-events-auto w-full rounded-md border border-accent bg-surface/95 px-2 py-1 text-sm text-foreground shadow-overlay outline-none"
                  style={{ color: text.color }}
                  onChange={(event) => updateText(text.id, event.target.value)}
                  onBlur={() => finishText(text.id)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') {
                      event.stopPropagation()
                      event.currentTarget.blur()
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  title={text.text}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    if (tool === 'text') setEditingTextId(text.id)
                  }}
                  className={`max-w-full truncate rounded-md border border-separator bg-surface/95 px-2 py-1 text-left text-sm shadow-overlay ${
                    tool === 'text' ? 'pointer-events-auto cursor-text' : 'pointer-events-none'
                  }`}
                  style={{ color: text.color }}
                >
                  {text.text}
                </button>
              )}
            </div>
          )
        })}
        <svg className="h-full w-full">
          {[...strokes, ...(draft ? [draft] : [])].map((stroke, index) => (
            <path
              key={index}
              d={strokePath(stroke.points, stroke.size)}
              fill={stroke.color}
              opacity={stroke.tool === 'highlight' ? 0.35 : 1}
            />
          ))}
        </svg>
      </div>
      <div
        className="pointer-events-auto absolute right-3 top-3 flex flex-wrap items-center gap-1 rounded-lg border border-separator bg-surface/95 p-1 shadow-overlay"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {(
          [
            ['pen', '笔 P'],
            ['highlight', '高亮 H'],
            ['text', '文字 T'],
            ['eraser', '橡皮 E'],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={tool === value ? 'primary' : 'tertiary'}
            onPress={() => setTool(value)}
          >
            {label}
          </Button>
        ))}
        {COLORS.map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`颜色 ${value}`}
            onClick={() => setColor(value)}
            className={`h-5 w-5 rounded-full border ${color === value ? 'border-foreground' : 'border-separator'}`}
            style={{ background: value }}
          />
        ))}
        <input
          aria-label="笔粗细"
          type="range"
          min={2}
          max={12}
          value={size}
          onChange={(event) => setSize(Number(event.target.value))}
        />
        <Button
          size="sm"
          variant="tertiary"
          onPress={() => {
            setStrokes([])
            setDraft(null)
            setTexts([])
            setEditingTextId(null)
            setNote('')
          }}
        >
          清空
        </Button>
        <Button size="sm" variant="primary" onPress={() => void save()} isDisabled={saving}>
          {saving ? '保存中…' : '保存标注'}
        </Button>
        <Button size="sm" variant="tertiary" onPress={onClose}>
          退出
        </Button>
      </div>
      {strokes.length > 0 || texts.length > 0 ? (
        <div
          className="pointer-events-auto absolute bottom-4 left-1/2 w-[min(420px,90%)] -translate-x-1/2 rounded-lg border border-separator bg-surface/95 p-2 shadow-overlay"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Input
            aria-label="标注说明"
            placeholder="这条标注要改什么？"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
            fullWidth
          />
        </div>
      ) : null}
    </div>
  )
}
