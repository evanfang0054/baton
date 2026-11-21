export interface NodeRect {
  x: number
  y: number
  w: number
  h: number
}

/** 以节点包围盒加 padding 生成分组框；调用方保证 nodes 非空。 */
export function groupBounds(nodes: NodeRect[], padding = 24): NodeRect {
  const minX = Math.min(...nodes.map((node) => node.x)) - padding
  const minY = Math.min(...nodes.map((node) => node.y)) - padding
  const maxX = Math.max(...nodes.map((node) => node.x + node.w)) + padding
  const maxY = Math.max(...nodes.map((node) => node.y + node.h)) + padding
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * 拖拽落点用节点中心点判定；重叠时取面积最小的组，避免大组吞掉小组。
 */
export function findContainingGroup<T extends NodeRect & { id: string }>(
  rect: NodeRect,
  groups: T[],
): T | null {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const hits = groups.filter(
    (group) => cx >= group.x && cx <= group.x + group.w && cy >= group.y && cy <= group.y + group.h,
  )
  hits.sort((a, b) => a.w * a.h - b.w * b.h)
  return hits[0] ?? null
}
