import type { DrawingOperation } from '@baton/protocol'

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

/** 写入限制比读取上限更严格：模型一次写入不能撑爆画板或请求体。 */
export const DRAWING_WRITE_LIMITS = {
  maxElements: 500,
  maxTextChars: 200_000,
  maxOperations: 50,
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

type SceneElement = Record<string, unknown> & {
  id: string
  type: string
  isDeleted?: boolean
  boundElements?: Array<{ id: string; type: string }> | null
  containerId?: string | null
}

export interface DrawingScene {
  type: 'excalidraw'
  version: 2
  source: string
  elements: SceneElement[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

export interface DrawingImageFile {
  dataURL: string
  mimeType: string
  width: number
  height: number
}

/** daemon 解析工作区图片后注入；core 只负责写入 scene，不做 IO。 */
export type ResolvedDrawingOperation = DrawingOperation & { image?: DrawingImageFile }

export type DrawingOperationErrorCode =
  'drawing_operation_invalid' | 'drawing_too_many_elements' | 'drawing_too_large'

export class DrawingOperationError extends Error {
  constructor(
    readonly code: DrawingOperationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DrawingOperationError'
  }
}

const DEFAULT_FONT_SIZE = 20
const MAX_OPERATIONS = DRAWING_WRITE_LIMITS.maxOperations

function hashNumber(input: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return Math.max(1, Math.abs(hash) % 2_147_483_647)
}

export function createEmptyScene(): DrawingScene {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'baton',
    elements: [],
    appState: { viewBackgroundColor: '#ffffff', gridSize: null },
    files: {},
  }
}

function sceneOf(scene: unknown): DrawingScene {
  if (
    scene &&
    typeof scene === 'object' &&
    Array.isArray((scene as { elements?: unknown }).elements)
  ) {
    const value = scene as DrawingScene
    return {
      ...value,
      type: 'excalidraw',
      version: 2,
      source: typeof value.source === 'string' ? value.source : 'baton',
      elements: value.elements,
      appState: value.appState && typeof value.appState === 'object' ? value.appState : {},
      files: value.files && typeof value.files === 'object' ? value.files : {},
    }
  }
  return createEmptyScene()
}

function strokeFor(type: string): string {
  if (type === 'text') return '#1e1e1e'
  return '#1e1e1e'
}

function elementBase(input: {
  id: string
  type: string
  x: number
  y: number
  w: number
  h: number
  index: number
  now: number
}): SceneElement {
  return {
    id: input.id,
    type: input.type,
    x: input.x,
    y: input.y,
    width: input.w,
    height: input.h,
    angle: 0,
    strokeColor: strokeFor(input.type),
    backgroundColor: input.type === 'text' ? 'transparent' : '#ffffff',
    fillStyle: 'solid',
    strokeWidth: input.type === 'text' ? 1 : 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness:
      input.type === 'arrow' || input.type === 'text'
        ? null
        : input.type === 'diamond'
          ? { type: 2 }
          : { type: 3 },
    seed: hashNumber(input.id),
    version: 1,
    versionNonce: hashNumber(`${input.id}:nonce`),
    isDeleted: false,
    boundElements: [],
    updated: input.now,
    link: null,
    locked: false,
    index: `a${input.index}`,
  }
}

function textElement(input: {
  id: string
  text: string
  x: number
  y: number
  w: number
  h: number
  index: number
  now: number
  containerId?: string
}): SceneElement {
  return {
    ...elementBase({
      id: input.id,
      type: 'text',
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      index: input.index,
      now: input.now,
    }),
    text: input.text,
    originalText: input.text,
    fontSize: DEFAULT_FONT_SIZE,
    fontFamily: 1,
    textAlign: input.containerId ? 'center' : 'left',
    verticalAlign: input.containerId ? 'middle' : 'top',
    containerId: input.containerId ?? null,
    lineHeight: 1.25,
    autoResize: true,
    baseline: input.h,
  }
}

function nextId(options: DrawingOperationOptions, requested?: string): string {
  if (requested) {
    if (options.usedIds.has(requested)) {
      throw new DrawingOperationError(
        'drawing_operation_invalid',
        `duplicate element id: ${requested}`,
      )
    }
    options.usedIds.add(requested)
    return requested
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = options.newId()
    if (!options.usedIds.has(candidate)) {
      options.usedIds.add(candidate)
      return candidate
    }
  }
  throw new DrawingOperationError('drawing_operation_invalid', 'could not allocate element id')
}

interface DrawingOperationOptions {
  newId: () => string
  now: number
  usedIds: Set<string>
  limits: { maxElements: number; maxTextChars: number }
}

function findElement(scene: DrawingScene, id: string): SceneElement {
  const element = scene.elements.find((item) => item.id === id && item.isDeleted !== true)
  if (!element) {
    throw new DrawingOperationError('drawing_operation_invalid', `element not found: ${id}`)
  }
  return element
}

function boundText(scene: DrawingScene, shape: SceneElement): SceneElement | undefined {
  const bound = (shape.boundElements ?? []).find((item) => item.type === 'text')
  return bound
    ? scene.elements.find((item) => item.id === bound.id && item.isDeleted !== true)
    : undefined
}

function addLabel(
  scene: DrawingScene,
  shape: SceneElement,
  text: string,
  options: DrawingOperationOptions,
): void {
  const id = nextId(options)
  const label = textElement({
    id,
    text,
    x: Number(shape.x) + 12,
    y: Number(shape.y) + Number(shape.height) / 2 - 12,
    w: Math.max(24, Number(shape.width) - 24),
    h: 24,
    index: scene.elements.length,
    now: options.now,
    containerId: shape.id,
  })
  shape.boundElements = [
    ...((shape.boundElements as Array<{ id: string; type: string }> | undefined) ?? []),
    { id, type: 'text' },
  ]
  scene.elements.push(label)
}

function moveBoundElements(
  scene: DrawingScene,
  element: SceneElement,
  dx: number,
  dy: number,
): void {
  for (const item of scene.elements) {
    const inContainer = item.containerId === element.id
    const boundTo = (item.boundElements as Array<{ id: string }> | undefined)?.some(
      (bound) => bound.id === element.id,
    )
    if (inContainer || boundTo) {
      item.x = Number(item.x) + dx
      item.y = Number(item.y) + dy
    }
  }
}

function applyOperation(
  scene: DrawingScene,
  operation: ResolvedDrawingOperation,
  options: DrawingOperationOptions,
): void {
  switch (operation.op) {
    case 'add_text': {
      const w = operation.w ?? Math.max(80, Math.min(600, operation.text.length * 14))
      const h = operation.h ?? 28
      scene.elements.push(
        textElement({
          id: nextId(options, operation.id),
          text: operation.text,
          x: operation.x,
          y: operation.y,
          w,
          h,
          index: scene.elements.length,
          now: options.now,
        }),
      )
      return
    }
    case 'add_shape': {
      const shape = elementBase({
        id: nextId(options, operation.id),
        type: operation.shape,
        x: operation.x,
        y: operation.y,
        w: operation.w,
        h: operation.h,
        index: scene.elements.length,
        now: options.now,
      })
      scene.elements.push(shape)
      if (operation.text) addLabel(scene, shape, operation.text, options)
      return
    }
    case 'add_arrow':
    case 'add_line': {
      const line = elementBase({
        id: nextId(options, operation.id),
        type: operation.op === 'add_arrow' ? 'arrow' : 'line',
        x: operation.x,
        y: operation.y,
        w: operation.w,
        h: operation.h,
        index: scene.elements.length,
        now: options.now,
      })
      Object.assign(line, {
        // Excalidraw 序列化时 points 是 [x, y] 数组，不是 {x, y} 对象。
        points: [
          [0, 0],
          [operation.w, operation.h],
        ],
        lastCommittedPoint: null,
        startBinding:
          operation.op === 'add_arrow' && operation.fromId
            ? { elementId: operation.fromId, focus: 0, gap: 8 }
            : null,
        endBinding:
          operation.op === 'add_arrow' && operation.toId
            ? { elementId: operation.toId, focus: 0, gap: 8 }
            : null,
        startArrowhead: null,
        endArrowhead: operation.op === 'add_arrow' ? 'arrow' : null,
      })
      if (operation.op === 'add_arrow' && operation.fromId) {
        const from = findElement(scene, operation.fromId)
        from.boundElements = [
          ...((from.boundElements as Array<{ id: string; type: string }> | undefined) ?? []),
          { id: line.id, type: 'arrow' },
        ]
      }
      if (operation.op === 'add_arrow' && operation.toId) {
        const to = findElement(scene, operation.toId)
        to.boundElements = [
          ...((to.boundElements as Array<{ id: string; type: string }> | undefined) ?? []),
          { id: line.id, type: 'arrow' },
        ]
      }
      scene.elements.push(line)
      return
    }
    case 'add_freedraw': {
      const xs = operation.points.map((point) => point.x)
      const ys = operation.points.map((point) => point.y)
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      const width = Math.max(1, Math.max(...xs) - minX)
      const height = Math.max(1, Math.max(...ys) - minY)
      const free = elementBase({
        id: nextId(options, operation.id),
        type: 'freedraw',
        x: operation.x + minX,
        y: operation.y + minY,
        w: width,
        h: height,
        index: scene.elements.length,
        now: options.now,
      })
      Object.assign(free, {
        points: operation.points.map((point) => [point.x - minX, point.y - minY]),
        pressures: [],
        simulatePressure: true,
        lastCommittedPoint: null,
      })
      scene.elements.push(free)
      return
    }
    case 'add_image': {
      if (!operation.image) {
        throw new DrawingOperationError(
          'drawing_operation_invalid',
          'image operation requires a resolved image',
        )
      }
      const fileId = `${nextId(options)}-file`
      scene.files[fileId] = {
        id: fileId,
        mimeType: operation.image.mimeType,
        dataURL: operation.image.dataURL,
        created: options.now,
      }
      const image = elementBase({
        id: nextId(options, operation.id),
        type: 'image',
        x: operation.x,
        y: operation.y,
        w: operation.w ?? operation.image.width,
        h: operation.h ?? operation.image.height,
        index: scene.elements.length,
        now: options.now,
      })
      Object.assign(image, {
        fileId,
        status: 'saved',
        scale: [1, 1],
        crop: null,
      })
      scene.elements.push(image)
      return
    }
    case 'update_text': {
      const element = findElement(scene, operation.id)
      if (element.type !== 'text') {
        throw new DrawingOperationError(
          'drawing_operation_invalid',
          `element is not text: ${operation.id}`,
        )
      }
      element.text = operation.text
      element.originalText = operation.text
      return
    }
    case 'move_element': {
      const element = findElement(scene, operation.id)
      const targetX = operation.x ?? Number(element.x) + (operation.dx ?? 0)
      const targetY = operation.y ?? Number(element.y) + (operation.dy ?? 0)
      const dx = targetX - Number(element.x)
      const dy = targetY - Number(element.y)
      element.x = targetX
      element.y = targetY
      if (dx !== 0 || dy !== 0) moveBoundElements(scene, element, dx, dy)
      return
    }
    case 'resize_element': {
      const element = findElement(scene, operation.id)
      element.width = operation.w
      element.height = operation.h
      const label = boundText(scene, element)
      if (label) {
        label.x = Number(element.x) + 12
        label.y = Number(element.y) + Number(element.height) / 2 - 12
        label.width = Math.max(24, Number(element.width) - 24)
      }
      return
    }
    case 'delete_elements': {
      for (const id of operation.ids) {
        const element = findElement(scene, id)
        element.isDeleted = true
        if (element.type === 'text' && element.containerId) {
          const container = scene.elements.find((item) => item.id === element.containerId)
          if (container) {
            container.boundElements = (
              (container.boundElements as Array<{ id: string; type: string }> | undefined) ?? []
            ).filter((bound) => bound.id !== element.id)
          }
        }
        const label = boundText(scene, element)
        if (label) label.isDeleted = true
      }
      return
    }
    case 'set_style': {
      const element = findElement(scene, operation.id)
      for (const key of [
        'strokeColor',
        'backgroundColor',
        'fillStyle',
        'strokeWidth',
        'strokeStyle',
        'roughness',
        'opacity',
      ] as const) {
        if (operation[key] !== undefined) element[key] = operation[key]
      }
      return
    }
    case 'set_title':
      // 标题存在画布节点上，不在 scene 里；由 daemon 画板服务处理。
      return
  }
}

/** 纯函数写入：所有时间/ID/图片都由调用方注入，便于测试与审计。 */
export function applyDrawingOperations(
  scene: unknown,
  operations: ResolvedDrawingOperation[],
  input: {
    newId: () => string
    now: number
    limits?: Partial<{ maxElements: number; maxTextChars: number }>
  },
): DrawingScene {
  if (operations.length > MAX_OPERATIONS) {
    throw new DrawingOperationError(
      'drawing_operation_invalid',
      `too many operations: ${operations.length}`,
    )
  }
  const next = structuredClone(sceneOf(scene))
  const use = drawLimits(input.limits, DRAWING_WRITE_LIMITS)
  const options: DrawingOperationOptions = {
    newId: input.newId,
    now: input.now,
    usedIds: new Set(
      next.elements.filter((item) => item.isDeleted !== true).map((item) => item.id),
    ),
    limits: use,
  }
  for (const operation of operations) applyOperation(next, operation, options)

  const live = next.elements.filter((item) => item.isDeleted !== true)
  if (live.length > use.maxElements) {
    throw new DrawingOperationError(
      'drawing_too_many_elements',
      `drawing has too many elements: ${live.length}`,
    )
  }
  const textChars = live.reduce(
    (total, item) => total + (item.type === 'text' ? String(item.text ?? '').length : 0),
    0,
  )
  if (textChars > use.maxTextChars) {
    throw new DrawingOperationError('drawing_too_large', 'drawing text is too large')
  }
  return next
}

export function drawLimits(
  input?: Partial<{ maxElements: number; maxTextChars: number }>,
  fallback: { maxElements: number; maxTextChars: number } = DRAWING_LIMITS,
): {
  maxElements: number
  maxTextChars: number
} {
  const maxElements = input?.maxElements ?? fallback.maxElements
  const maxTextChars = input?.maxTextChars ?? fallback.maxTextChars
  return {
    maxElements: Math.max(0, Math.floor(maxElements)),
    maxTextChars: Math.max(0, Math.floor(maxTextChars)),
  }
}
