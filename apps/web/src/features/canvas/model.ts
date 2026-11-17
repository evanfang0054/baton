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
  const taskByNode = new Map(tasks.map((task) => [task.nodeId, task]))
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
    selectable: false,
    focusable: false,
    deletable: false,
  }))
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
