import type { Edge, Node, TaskDetail } from '@baton/protocol'

export interface TaskScene {
  taskId: string
  relatedNodeIds: string[]
  /** 包含相关节点的分组框；现场需要高亮而不是降暗。 */
  relatedGroupIds: string[]
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

/** 任务直接相关的节点 ID：目标 Agent + context 快照 + origin 显式上下文 + 注入节点。 */
export function relatedNodeIdSet(task: TaskDetail): Set<string> {
  const related = new Set<string>()
  if (task.nodeId) related.add(task.nodeId)
  for (const ref of task.context?.included ?? []) related.add(ref.id)
  for (const id of task.origin?.contextNodeIds ?? []) related.add(id)
  for (const injection of task.context?.injections ?? []) {
    for (const id of injection.nodeIds) related.add(id)
  }
  return related
}

/** review 卡固定在 Agent 右侧；目标不是 Agent 或缺失时回退 (0, 0)。 */
export function reviewCardPosition(task: TaskDetail, nodes: Node[]): { x: number; y: number } {
  const agent = task.nodeId ? nodes.find((node) => node.id === task.nodeId) : undefined
  return agent?.type === 'agent' ? { x: agent.x + agent.w + 40, y: agent.y } : { x: 0, y: 0 }
}

/**
 * 现场是任务事实的投影，不落库：
 * - 相关节点 = 目标 Agent + 创建时 context 快照 + origin 显式上下文
 * - 相关 group 框需要高亮；折叠的现场临时展开
 * - 只保留两端都相关的边
 */
export function buildTaskScene(task: TaskDetail, nodes: Node[], edges: Edge[]): TaskScene {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const related = relatedNodeIdSet(task)

  const relatedNodeIds = [...related].filter((id) => byId.has(id))
  const missingNodeIds = [...related].filter((id) => !byId.has(id))
  const relatedSet = new Set(relatedNodeIds)

  const relatedGroupIds = new Set<string>()
  for (const id of relatedNodeIds) {
    const groupId = byId.get(id)?.groupId
    if (groupId && byId.get(groupId)?.type === 'group') relatedGroupIds.add(groupId)
  }

  const expandGroupIds = [...relatedGroupIds].filter((id) => {
    const group = byId.get(id)
    return group?.type === 'group' && group.data.collapsed
  })

  return {
    taskId: task.id,
    relatedNodeIds,
    relatedGroupIds: [...relatedGroupIds],
    relatedEdgeIds: edges
      .filter((edge) => relatedSet.has(edge.sourceId) && relatedSet.has(edge.targetId))
      .map((edge) => edge.id),
    expandGroupIds,
    missingNodeIds,
    showReviewCard: task.status === 'review',
    reviewCardPosition: reviewCardPosition(task, nodes),
  }
}
