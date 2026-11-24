import { findContainingGroup, type TaskScene } from '@baton/core'
import type {
  Artifact,
  DeliverySummary,
  Edge as ProtocolEdge,
  Node as ProtocolNode,
  ReviewView,
  StageSummary,
  TaskAcceptanceSummary,
  TaskSummary,
} from '@baton/protocol'
import type { Edge as FlowEdge, Node as FlowNode } from '@xyflow/react'

export interface CanvasNodeData extends Record<string, unknown> {
  node: ProtocolNode
  task: TaskSummary | null
  dimmed?: boolean
  imageUrl?: string
  review?: ReviewView | null
  acceptance?: TaskAcceptanceSummary | null
  childCount?: number
  injected?: boolean
  stage?: StageSummary | null
  artifact?: Artifact | null
  previewUrl?: string
}

export interface CanvasRenderOptions {
  scene?: TaskScene | null
  reviewDetails?: Record<string, ReviewView>
  workspaceId?: string
  injectedNodeIds?: ReadonlySet<string>
  delivery?: DeliverySummary | null
  stages?: StageSummary[]
  artifacts?: Artifact[]
  deliveryId?: string
}

export type CanvasAddType = 'drawing' | 'file' | 'agent' | 'group'

const CUSTOM_TYPES = new Set<ProtocolNode['type']>([
  'text',
  'file',
  'agent',
  'image',
  'group',
  'review',
  'artifact',
  'drawing',
])

export const REVIEW_CARD_PREFIX = 'review:'

export function reviewCardId(taskId: string): string {
  return `${REVIEW_CARD_PREFIX}${taskId}`
}

/** 本地图片走受控读取路由；外链原样交给浏览器，daemon 不代理。 */
export function resolveImageUrl(src: string, workspaceId?: string): string | undefined {
  const prefix = '.baton/uploads/'
  if (!src.startsWith(prefix)) return src.startsWith('https://') ? src : undefined
  if (!workspaceId) return undefined
  return `/api/workspaces/${workspaceId}/uploads/${encodeURIComponent(src.slice(prefix.length))}`
}

function drawingPreviewUrl(
  node: ProtocolNode,
  artifactById: Map<string, Artifact>,
  deliveryId: string | undefined,
): string | undefined {
  if (node.type !== 'drawing' || !deliveryId) return undefined
  const artifact = artifactById.get(node.data.artifactId)
  const version = artifact?.updatedAt ?? node.updatedAt
  return `/api/deliveries/${encodeURIComponent(deliveryId)}/artifacts/${encodeURIComponent(
    node.data.artifactId,
  )}/content?variant=preview&v=${version}`
}

export function toFlowNodes(
  nodes: ProtocolNode[],
  tasks: TaskSummary[],
  options: CanvasRenderOptions = {},
): FlowNode<CanvasNodeData>[] {
  const scene = options.scene ?? null
  const related = new Set(scene?.relatedNodeIds ?? [])
  const relatedGroups = new Set(scene?.relatedGroupIds ?? [])
  const expanded = new Set(scene?.expandGroupIds ?? [])
  const groupById = new Map(
    nodes.filter((node) => node.type === 'group').map((node) => [node.id, node]),
  )
  const stageByKey = new Map((options.stages ?? []).map((stage) => [stage.key, stage]))
  const artifactById = new Map((options.artifacts ?? []).map((artifact) => [artifact.id, artifact]))

  // 同一 Agent 可能有多条历史任务；节点徽标必须显示最新创建的一条。
  const taskByNode = new Map<string, TaskSummary>()
  for (const task of tasks) {
    if (!task.nodeId) continue
    const current = taskByNode.get(task.nodeId)
    if (!current || task.createdAt > current.createdAt) taskByNode.set(task.nodeId, task)
  }

  const groups = nodes
    .filter((node) => node.type === 'group')
    .map((node) => ({
      id: node.id,
      type: 'group',
      position: { x: node.x, y: node.y },
      style: { width: node.w, height: node.h },
      data: {
        node,
        task: null,
        dimmed: scene ? !relatedGroups.has(node.id) : false,
        childCount: nodes.filter((child) => child.groupId === node.id).length,
        injected: options.injectedNodeIds?.has(node.id) ?? false,
        stage: node.data.stageKey ? (stageByKey.get(node.data.stageKey) ?? null) : null,
      },
    }))

  const base = nodes
    .filter((node) => node.type !== 'group')
    .map((node) => {
      const group = node.groupId ? groupById.get(node.groupId) : undefined
      const hidden = Boolean(
        group?.type === 'group' && group.data.collapsed && !expanded.has(group.id),
      )
      return {
        id: node.id,
        type: CUSTOM_TYPES.has(node.type) ? node.type : 'default',
        // React Flow 的父子节点用相对坐标；协议里的 x/y 始终是绝对坐标。
        position: group ? { x: node.x - group.x, y: node.y - group.y } : { x: node.x, y: node.y },
        ...(group ? { parentId: group.id } : {}),
        hidden,
        style: { width: node.w, height: node.h },
        data: {
          node,
          task: taskByNode.get(node.id) ?? null,
          dimmed: scene ? !related.has(node.id) : false,
          injected: options.injectedNodeIds?.has(node.id) ?? false,
          ...(node.type === 'image'
            ? { imageUrl: resolveImageUrl(node.data.src, options.workspaceId) }
            : {}),
          ...(node.type === 'artifact'
            ? { artifact: artifactById.get(node.data.artifactId) ?? null }
            : {}),
          ...(node.type === 'drawing'
            ? { previewUrl: drawingPreviewUrl(node, artifactById, options.deliveryId) }
            : {}),
        },
      }
    })

  // 全局只展示当前处于 review 的任务卡；现场只展示目标任务自己的卡。
  const reviewTasks = scene
    ? tasks.filter((task) => task.id === scene.taskId && scene.showReviewCard)
    : tasks.filter((task) => task.status === 'review')
  const reviewCards = reviewTasks.map((task) => {
    const agent = nodes.find((node) => node.id === task.nodeId)
    const position =
      scene && task.id === scene.taskId
        ? scene.reviewCardPosition
        : agent
          ? { x: agent.x + agent.w + 40, y: agent.y }
          : { x: 0, y: 0 }
    return {
      id: reviewCardId(task.id),
      type: 'review',
      position,
      draggable: false,
      selectable: false,
      connectable: false,
      style: { width: 280, height: 180 },
      data: {
        node: {
          id: reviewCardId(task.id),
          canvasId: agent?.canvasId ?? '',
          type: 'review' as const,
          x: position.x,
          y: position.y,
          w: 280,
          h: 180,
          groupId: null,
          data: { taskId: task.id },
          createdAt: 0,
          updatedAt: 0,
        },
        task,
        dimmed: false,
        review: options.reviewDetails?.[task.id] ?? null,
        acceptance: task.acceptance ?? null,
      },
    }
  })

  return [...groups, ...base, ...reviewCards]
}

export function toFlowEdges(
  edges: ProtocolEdge[],
  scene?: TaskScene | null,
  hiddenNodeIds?: ReadonlySet<string>,
): FlowEdge[] {
  const allowed = scene ? new Set(scene.relatedEdgeIds) : null
  return edges
    .filter((edge) => !allowed || allowed.has(edge.id))
    .filter(
      (edge) =>
        !hiddenNodeIds || (!hiddenNodeIds.has(edge.sourceId) && !hiddenNodeIds.has(edge.targetId)),
    )
    .map((edge) => ({
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      selectable: true,
      focusable: true,
      deletable: true,
    }))
}

export function isValidConnection(
  connection: { source: string | null; target: string | null },
  edges: ProtocolEdge[],
): boolean {
  if (!connection.source || !connection.target) return false
  if (connection.source === connection.target) return false
  return !edges.some(
    (edge) =>
      edge.sourceId === connection.source &&
      edge.targetId === connection.target &&
      edge.type === 'context',
  )
}

export interface NodeRect {
  x: number
  y: number
  w: number
  h: number
}

function absolutePosition(
  node: FlowNode<CanvasNodeData>,
  all: FlowNode<CanvasNodeData>[],
): { x: number; y: number } {
  const parent = node.parentId ? all.find((item) => item.id === node.parentId) : undefined
  return parent
    ? { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y }
    : node.position
}

/** 整组拖动：group 和所有后代一次提交绝对坐标（嵌套分组也一样）。 */
export function groupMovePlan(
  node: FlowNode<CanvasNodeData>,
  all: FlowNode<CanvasNodeData>[],
): Array<{ nodeId: string; x: number; y: number }> {
  const plan = [{ nodeId: node.id, x: node.position.x, y: node.position.y }]
  const seen = new Set([node.id])
  const collect = (parent: FlowNode<CanvasNodeData>, parentX: number, parentY: number) => {
    for (const child of all) {
      if (child.parentId !== parent.id || seen.has(child.id)) continue
      seen.add(child.id)
      const x = parentX + child.position.x
      const y = parentY + child.position.y
      plan.push({ nodeId: child.id, x, y })
      collect(child, x, y)
    }
  }
  collect(node, node.position.x, node.position.y)
  return plan
}

/** 普通节点拖动结束：落点中心决定归入哪个 group。 */
export function dropPatch(
  node: FlowNode<CanvasNodeData>,
  all: FlowNode<CanvasNodeData>[],
  canvasNodes: ProtocolNode[],
): { x: number; y: number; groupId: string | null } {
  const absolute = absolutePosition(node, all)
  const groups = canvasNodes.filter((item) => item.type === 'group')
  const group = findContainingGroup(
    { ...absolute, w: node.data.node.w, h: node.data.node.h },
    groups,
  )
  return { ...absolute, groupId: group?.id ?? null }
}

export interface CanvasBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const COLUMN_ORDER = [0, 1, -1, 2, -2] as const
const MAX_ROWS = 20

function overlaps(candidate: NodeRect, other: NodeRect, gap: number): boolean {
  return (
    candidate.x < other.x + other.w + gap &&
    candidate.x + candidate.w + gap > other.x &&
    candidate.y < other.y + other.h + gap &&
    candidate.y + candidate.h + gap > other.y
  )
}

function withinBounds(candidate: NodeRect, bounds: CanvasBounds): boolean {
  return (
    candidate.x >= bounds.minX &&
    candidate.y >= bounds.minY &&
    candidate.x + candidate.w <= bounds.maxX &&
    candidate.y + candidate.h <= bounds.maxY
  )
}

/**
 * 以视口中心为基准找最近的空位：先居中，再向右/左展开，最后换行。
 * 避免连续新建的节点以 32px 级联叠在一起，导致“怎么会都在一坨”。
 */
export function nextNodePosition(
  center: { x: number; y: number },
  size: { w: number; h: number },
  nodes: NodeRect[],
  gap = 24,
  bounds?: CanvasBounds,
): { x: number; y: number } {
  const baseX = center.x - size.w / 2
  const baseY = center.y - size.h / 2
  const stepX = size.w + gap
  const stepY = size.h + gap

  const search = (respectBounds: boolean): { x: number; y: number } | null => {
    for (let row = 0; row < MAX_ROWS; row += 1) {
      for (const column of COLUMN_ORDER) {
        const candidate: NodeRect = {
          x: baseX + column * stepX,
          y: baseY + row * stepY,
          w: size.w,
          h: size.h,
        }
        if (respectBounds && bounds && !withinBounds(candidate, bounds)) {
          continue
        }
        if (!nodes.some((node) => overlaps(candidate, node, gap))) {
          return { x: candidate.x, y: candidate.y }
        }
      }
    }
    return null
  }

  const inBounds = search(true)
  if (inBounds) return inBounds

  // 视口内没有空位时，宁可把节点放到视野外，也不能盖在已有节点上：
  // 重叠会让连线手柄互相遮挡，用户连“拖开再连线”都做不到。
  const anywhere = search(false)
  if (anywhere) return anywhere

  const bottom = nodes.reduce((max, node) => Math.max(max, node.y + node.h), baseY)
  return { x: baseX, y: bottom + gap }
}

/** 合并服务端快照；拖拽中的节点保留本地位置，避免任务刷新把节点拉回去。 */
export function mergeFlowNodes(
  current: FlowNode<CanvasNodeData>[],
  incoming: FlowNode<CanvasNodeData>[],
): FlowNode<CanvasNodeData>[] {
  const byId = new Map(current.map((node) => [node.id, node]))
  return incoming.map((next) => {
    const previous = byId.get(next.id)
    if (!previous) return next
    return {
      ...previous,
      ...next,
      position: previous.dragging ? previous.position : next.position,
    }
  })
}
