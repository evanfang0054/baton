import type { Edge, Node, TaskDetail } from '@baton/protocol'

export interface TaskScene {
  taskId: string
  relatedNodeIds: string[]
  relatedEdgeIds: string[]
  /** 需要临时展开的 group；现场退出后恢复原折叠状态。 */
  expandGroupIds: string[]
  /** context/origin 引用但当前画布已不存在的节点。 */
  missingNodeIds: string[]
  /** 是否显示派生 review 卡。 */
  showReviewCard: boolean
  /** review 卡固定位置；Agent 缺失时回退 (0, 0)。 */
  reviewCardPosition: { x: number; y: number }
}

/**
 * 现场是任务事实的投影，不落库：
 * - 相关节点 = 目标 Agent + 创建时 context 快照 + origin 显式上下文
 * - 只保留两端都相关的边
 * - 相关 group 若折叠，现场临时展开
 */
export function buildTaskScene(task: TaskDetail, nodes: Node[], edges: Edge[]): TaskScene {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const related = new Set<string>()
  if (task.nodeId) related.add(task.nodeId)
  for (const ref of task.context?.included ?? []) related.add(ref.id)
  for (const id of task.origin?.contextNodeIds ?? []) related.add(id)

  const relatedNodeIds = [...related].filter((id) => byId.has(id))
  const missingNodeIds = [...related].filter((id) => !byId.has(id))
  const relatedSet = new Set(relatedNodeIds)

  const expandGroupIds = new Set<string>()
  for (const id of relatedNodeIds) {
    const groupId = byId.get(id)?.groupId
    if (!groupId) continue
    const group = byId.get(groupId)
    if (group?.type === 'group' && group.data.collapsed) expandGroupIds.add(groupId)
  }

  const agent = task.nodeId ? byId.get(task.nodeId) : undefined
  return {
    taskId: task.id,
    relatedNodeIds,
    relatedEdgeIds: edges
      .filter((edge) => relatedSet.has(edge.sourceId) && relatedSet.has(edge.targetId))
      .map((edge) => edge.id),
    expandGroupIds: [...expandGroupIds],
    missingNodeIds,
    showReviewCard: task.status === 'review',
    reviewCardPosition: agent ? { x: agent.x + agent.w + 40, y: agent.y } : { x: 0, y: 0 },
  }
}
