import type { Node, NodeMoveManyInput } from '@baton/protocol'

export type CanvasNodeMove = NodeMoveManyInput['moves'][number]

const MARGIN = 80
const GAP = 80
const MAX_ROW_WIDTH = 1600

interface LayoutUnit {
  node: Node
  children: Node[]
  x: number
  y: number
  w: number
  h: number
}

function byVisualOrder(a: LayoutUnit, b: LayoutUnit): number {
  if (a.y !== b.y) return a.y - b.y
  if (a.x !== b.x) return a.x - b.x
  return a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0
}

/**
 * 自动整理画布：按当前视觉顺序从左到右、从上到下做行式排布。
 *
 * - 分组作为整体移动，组内子节点保持相对位置，避免框和内容错位；
 * - 只移动顶层单元，嵌套分组（如历史数据）不会再被父组重复移动；
 * - 输出是绝对坐标，可直接用于 node.move_many。
 */
export function arrangeCanvasNodes(nodes: Node[]): CanvasNodeMove[] {
  if (nodes.length === 0) return []

  const groupIds = new Set(nodes.filter((node) => node.type === 'group').map((node) => node.id))
  const childrenByGroup = new Map<string, Node[]>()
  for (const node of nodes) {
    if (!node.groupId || !groupIds.has(node.groupId)) continue
    const children = childrenByGroup.get(node.groupId) ?? []
    children.push(node)
    childrenByGroup.set(node.groupId, children)
  }

  const units: LayoutUnit[] = []
  const collectChildren = (groupId: string, seen: Set<string>): Node[] => {
    const children: Node[] = []
    for (const child of childrenByGroup.get(groupId) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      children.push(child)
      if (child.type === 'group') children.push(...collectChildren(child.id, seen))
    }
    return children
  }
  for (const node of nodes) {
    if (node.groupId && groupIds.has(node.groupId)) continue
    units.push({
      node,
      children: node.type === 'group' ? collectChildren(node.id, new Set([node.id])) : [],
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
    })
  }
  units.sort(byVisualOrder)

  const moves: CanvasNodeMove[] = []
  let cursorX = MARGIN
  let cursorY = MARGIN
  let rowHeight = 0

  for (const unit of units) {
    if (cursorX > MARGIN && cursorX + unit.w > MARGIN + MAX_ROW_WIDTH) {
      cursorX = MARGIN
      cursorY += rowHeight + GAP
      rowHeight = 0
    }

    const dx = cursorX - unit.x
    const dy = cursorY - unit.y
    if (dx !== 0 || dy !== 0) {
      moves.push({ nodeId: unit.node.id, x: cursorX, y: cursorY })
      for (const child of unit.children) {
        moves.push({ nodeId: child.id, x: child.x + dx, y: child.y + dy })
      }
    }

    cursorX += unit.w + GAP
    rowHeight = Math.max(rowHeight, unit.h)
  }

  return moves
}
