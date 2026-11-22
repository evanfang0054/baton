import type { Node } from '@baton/protocol'
import type { CanvasNodeMove } from './layout.js'

const ORIGIN_X = 80
const ORIGIN_Y = 160
const STAGE_GAP_X = 540
const CHILD_OFFSET_X = 40
const CHILD_OFFSET_Y = 80
const CHILD_GAP_Y = 240
const CHILD_PER_ROW = 1

export function arrangeDeliveryCanvas(input: {
  stages: Array<{ key: string; ordinal: number }>
  nodes: Node[]
}): CanvasNodeMove[] {
  const moves: CanvasNodeMove[] = []
  const groupByStage = new Map<string, Node>()
  for (const node of input.nodes) {
    if (node.type === 'group' && node.data.stageKey) {
      groupByStage.set(node.data.stageKey, node)
    }
  }

  for (const stage of input.stages) {
    const group = groupByStage.get(stage.key)
    if (!group) continue
    const targetX = ORIGIN_X + (stage.ordinal - 1) * STAGE_GAP_X
    const targetY = ORIGIN_Y
    if (group.x !== targetX || group.y !== targetY) {
      moves.push({ nodeId: group.id, x: targetX, y: targetY })
    }
    const children = input.nodes.filter((node) => node.groupId === group.id)
    children.forEach((child, index) => {
      const x = targetX + CHILD_OFFSET_X + (index % CHILD_PER_ROW) * 360
      const y = targetY + CHILD_OFFSET_Y + Math.floor(index / CHILD_PER_ROW) * CHILD_GAP_Y
      if (child.x !== x || child.y !== y) moves.push({ nodeId: child.id, x, y })
    })
  }
  return moves
}
