export interface DrawingElement {
  id: string
  type: string
  x: number
  y: number
  w: number
  h: number
  text?: string
}

export interface DrawingText {
  id: string
  text: string
  x: number
  y: number
}

export interface DrawingBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface DrawingContent {
  elements: DrawingElement[]
  texts: DrawingText[]
  counts: Record<string, number>
  totalElements: number
  totalTexts: number
  bounds: DrawingBounds | null
  truncated: boolean
}

export interface DrawingSummary {
  summary: string
  textCount: number
  imageCount: number
}

export const DRAWING_LIMITS = {
  maxElements: 5_000,
  maxTextChars: 200_000,
} as const

function elementsOf(scene: unknown): unknown[] {
  if (Array.isArray(scene)) return scene
  if (!scene || typeof scene !== 'object') return []
  const value = (scene as { elements?: unknown }).elements
  return Array.isArray(value) ? value : []
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function toElement(raw: unknown): DrawingElement | null {
  if (!raw || typeof raw !== 'object') return null
  const element = raw as Record<string, unknown>
  if (element.isDeleted === true) return null
  const id = stringOrUndefined(element.id)
  const type = stringOrUndefined(element.type)
  if (!id || !type) return null
  const text = stringOrUndefined(element.text)
  return {
    id,
    type,
    x: numberOrZero(element.x),
    y: numberOrZero(element.y),
    w: numberOrZero(element.width),
    h: numberOrZero(element.height),
    ...(text === undefined ? {} : { text }),
  }
}

/**
 * 画板内容抽取：只读、确定性、不做 IO。
 * 图片只统计数量，不读取 Excalidraw files 里的 base64。
 */
export function extractDrawingContent(
  scene: unknown,
  limits: Partial<{ maxElements: number; maxTextChars: number }> = {},
): DrawingContent {
  const maxElements = Math.max(0, limits.maxElements ?? DRAWING_LIMITS.maxElements)
  const maxTextChars = Math.max(0, limits.maxTextChars ?? DRAWING_LIMITS.maxTextChars)
  const all = elementsOf(scene).flatMap((raw) => {
    const element = toElement(raw)
    return element ? [element] : []
  })

  const counts: Record<string, number> = {}
  for (const element of all) counts[element.type] = (counts[element.type] ?? 0) + 1

  const elements = all.slice(0, maxElements)
  const allTexts = elements
    .filter((element) => element.type === 'text' && element.text && element.text.trim().length > 0)
    .map((element, index) => ({
      id: element.id,
      text: element.text!,
      x: element.x,
      y: element.y,
      index,
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index)

  const texts: DrawingText[] = []
  let textChars = 0
  let truncated = all.length > elements.length
  for (const text of allTexts) {
    const remaining = maxTextChars - textChars
    if (remaining <= 0) {
      truncated = true
      break
    }
    if (text.text.length > remaining) {
      texts.push({ id: text.id, text: text.text.slice(0, remaining), x: text.x, y: text.y })
      textChars = maxTextChars
      truncated = true
      break
    }
    texts.push({ id: text.id, text: text.text, x: text.x, y: text.y })
    textChars += text.text.length
  }

  const bounds = elements.length
    ? elements.reduce<DrawingBounds>(
        (acc, element) => ({
          minX: Math.min(acc.minX, element.x),
          minY: Math.min(acc.minY, element.y),
          maxX: Math.max(acc.maxX, element.x + element.w),
          maxY: Math.max(acc.maxY, element.y + element.h),
        }),
        {
          minX: Number.POSITIVE_INFINITY,
          minY: Number.POSITIVE_INFINITY,
          maxX: Number.NEGATIVE_INFINITY,
          maxY: Number.NEGATIVE_INFINITY,
        },
      )
    : null

  return {
    elements,
    texts,
    counts,
    totalElements: all.length,
    totalTexts: allTexts.length,
    bounds,
    truncated,
  }
}

export function drawingSummary(scene: unknown): DrawingSummary {
  const content = extractDrawingContent(scene)
  const summary = content.texts
    .slice(0, 3)
    .map((text) => text.text.replace(/\s+/g, ' ').trim().slice(0, 60))
    .filter((text) => text.length > 0)
    .join(' / ')
    .slice(0, 200)
  return {
    summary,
    textCount: content.totalTexts,
    imageCount: content.counts.image ?? 0,
  }
}
