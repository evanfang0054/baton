import type { Edge as ProtocolEdge, Node as ProtocolNode, TaskSummary } from '@baton/protocol'
import type { Edge as FlowEdge, Node as FlowNode } from '@xyflow/react'

export interface CanvasNodeData extends Record<string, unknown> {
  node: ProtocolNode
  task: TaskSummary | null
}

const CUSTOM_TYPES = new Set(['text', 'file', 'agent'])

export function toFlowNodes(
  nodes: ProtocolNode[],
  tasks: TaskSummary[],
): FlowNode<CanvasNodeData>[] {
  // 同一 Agent 可能有多条历史任务；节点徽标必须显示最新创建的一条。
  const taskByNode = new Map<string, TaskSummary>()
  for (const task of tasks) {
    if (!task.nodeId) continue
    const current = taskByNode.get(task.nodeId)
    if (!current || task.createdAt > current.createdAt) taskByNode.set(task.nodeId, task)
  }
  return nodes.map((node) => ({
    id: node.id,
    type: CUSTOM_TYPES.has(node.type) ? node.type : 'default',
    position: { x: node.x, y: node.y },
    style: { width: node.w, height: node.h },
    data: { node, task: taskByNode.get(node.id) ?? null },
  }))
}

export function toFlowEdges(edges: ProtocolEdge[]): FlowEdge[] {
  return edges.map((edge) => ({
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
