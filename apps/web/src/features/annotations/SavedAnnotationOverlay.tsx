import type { AnnotationSummary } from '@baton/protocol'
import { useQueries } from '@tanstack/react-query'
import { useViewport } from '@xyflow/react'
import { getAnnotationDrawing } from '../../lib/api'
import { queryKeys } from '../../lib/query'
import {
  flowBBoxToScreen,
  projectPoint,
  strokePath,
  type FlowViewport,
  type QuickStroke,
  type QuickText,
} from './QuickAnnotationLayer'

interface Drawing {
  strokes: QuickStroke[]
  texts: QuickText[]
  viewport: FlowViewport | null
  flow: boolean
}

function parseDrawing(strokesJson: string): Drawing | null {
  try {
    const value = JSON.parse(strokesJson) as {
      strokes?: QuickStroke[]
      texts?: QuickText[]
      viewport?: FlowViewport
      coordinateSpace?: string
    }
    return {
      strokes: Array.isArray(value.strokes) ? value.strokes : [],
      texts: Array.isArray(value.texts) ? value.texts : [],
      viewport: value.viewport ?? null,
      flow: value.coordinateSpace === 'flow' && Boolean(value.viewport),
    }
  } catch {
    return null
  }
}

/**
 * 标注保存后常驻在画布上：flow 坐标随 React Flow 视口缩放/平移，
 * 旧 screen 坐标数据不做视口换算，按原值兜底显示。
 */
export function SavedAnnotationOverlay({ annotations }: { annotations: AnnotationSummary[] }) {
  const viewport = useViewport()
  const open = annotations.filter((annotation) => annotation.status === 'open')
  const drawings = useQueries({
    queries: open.map((annotation) => ({
      queryKey: queryKeys.annotationDrawing(annotation.id),
      queryFn: () => getAnnotationDrawing(annotation.id),
      staleTime: Infinity,
    })),
  })
  if (open.length === 0) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        {open.flatMap((annotation, index) => {
          const raw = drawings[index]?.data?.strokesJson
          const drawing = raw ? parseDrawing(raw) : null
          if (!drawing) return []
          const scale = drawing.flow && drawing.viewport ? viewport.zoom / drawing.viewport.zoom : 1
          return drawing.strokes.map((stroke, strokeIndex) => {
            const points =
              drawing.flow && drawing.viewport
                ? stroke.points.map((point) => projectPoint(point, drawing.viewport!, viewport))
                : stroke.points
            return (
              <path
                key={`${annotation.id}-${strokeIndex}`}
                d={strokePath(points, stroke.size * scale)}
                fill={stroke.color}
                opacity={stroke.tool === 'highlight' ? 0.35 : 1}
              />
            )
          })
        })}
      </svg>
      {open.map((annotation, index) => {
        const raw = drawings[index]?.data?.strokesJson
        const drawing = raw ? parseDrawing(raw) : null
        const texts = drawing?.texts.filter((text) => text.text.trim()) ?? []
        if (drawing && texts.length > 0) {
          return texts.map((text) => {
            const [x, y] =
              drawing.flow && drawing.viewport
                ? projectPoint([text.x, text.y], drawing.viewport, viewport)
                : [text.x, text.y]
            const scale =
              drawing.flow && drawing.viewport ? viewport.zoom / drawing.viewport.zoom : 1
            return (
              <div
                key={`${annotation.id}-${text.id}`}
                className="absolute rounded-md border border-separator bg-surface/95 px-2 py-1 text-sm shadow-overlay"
                style={{ left: x, top: y, color: text.color, fontSize: 14 * scale }}
              >
                {text.text}
              </div>
            )
          })
        }
        if (!annotation.note) return null
        const box =
          annotation.coordinateSpace === 'flow'
            ? flowBBoxToScreen(annotation.bbox, viewport)
            : annotation.bbox
        return (
          <div
            key={annotation.id}
            className="absolute rounded border-2 border-dashed border-warning/70 bg-warning/5 p-1 text-[11px] leading-tight text-warning"
            style={{ left: box.x, top: box.y, maxWidth: Math.max(box.w, 120) }}
            title={annotation.note}
          >
            <span className="line-clamp-3">{annotation.note}</span>
          </div>
        )
      })}
    </div>
  )
}
