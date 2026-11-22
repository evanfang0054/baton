import type { Node } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { arrangeDeliveryCanvas } from '../src/canvas/delivery-layout.js'

function group(id: string, stageKey: string, x: number, y: number): Node {
  return {
    id,
    canvasId: 'c1',
    type: 'group',
    x,
    y,
    w: 480,
    h: 360,
    groupId: null,
    createdAt: 1,
    updatedAt: 1,
    data: { label: stageKey, collapsed: false, stageKey },
  }
}
function child(id: string, groupId: string, x: number, y: number): Node {
  return {
    id,
    canvasId: 'c1',
    type: 'text',
    x,
    y,
    w: 320,
    h: 200,
    groupId,
    createdAt: 1,
    updatedAt: 1,
    data: { content: id },
  }
}

describe('arrangeDeliveryCanvas', () => {
  it('lays stages left-to-right and keeps children relative', () => {
    const nodes = [
      group('g1', 'requirement', 10, 10),
      child('c1', 'g1', 50, 80),
      group('g2', 'design', 600, 10),
      child('c2', 'g2', 640, 80),
    ]
    const moves = arrangeDeliveryCanvas({
      stages: [
        { key: 'requirement', ordinal: 1 },
        { key: 'design', ordinal: 2 },
      ],
      nodes,
    })
    expect(moves).toContainEqual({ nodeId: 'g1', x: 80, y: 160 })
    expect(moves).toContainEqual({ nodeId: 'c1', x: 120, y: 240 })
    expect(moves).toContainEqual({ nodeId: 'g2', x: 620, y: 160 })
    expect(moves).toContainEqual({ nodeId: 'c2', x: 660, y: 240 })
  })

  it('ignores nodes without a matching stage group', () => {
    const moves = arrangeDeliveryCanvas({
      stages: [{ key: 'requirement', ordinal: 1 }],
      nodes: [group('g1', 'requirement', 10, 10), child('orphan', 'missing', 0, 0)],
    })
    expect(moves.some((move) => move.nodeId === 'orphan')).toBe(false)
  })

  it('does not mutate input', () => {
    const g = group('g1', 'requirement', 10, 10)
    arrangeDeliveryCanvas({ stages: [{ key: 'requirement', ordinal: 1 }], nodes: [g] })
    expect(g.x).toBe(10)
  })
})
