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
