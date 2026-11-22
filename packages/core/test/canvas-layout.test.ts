import type { Node } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { arrangeCanvasNodes } from '../src/canvas/layout.js'

function node(
  id: string,
  x: number,
  y: number,
  options: { type?: 'text' | 'group'; groupId?: string | null; w?: number; h?: number } = {},
): Node {
  const type = options.type ?? 'text'
  const base = {
    id,
    canvasId: 'c1',
    x,
    y,
    w: options.w ?? (type === 'group' ? 400 : 320),
    h: options.h ?? (type === 'group' ? 300 : 200),
    groupId: options.groupId ?? null,
    createdAt: 1,
    updatedAt: 1,
  }
  return type === 'group'
    ? { ...base, type: 'group', data: { label: id, collapsed: false } }
    : { ...base, type: 'text', data: { content: id } }
}

describe('arrangeCanvasNodes', () => {
  it('lays nodes out in visual order with row wrapping', () => {
    const moves = arrangeCanvasNodes([
      node('d', 100, 300),
      node('b', 0, 100),
      node('a', 0, 0),
      node('c', 0, 200),
    ])
    expect(moves).toEqual([
      { nodeId: 'a', x: 80, y: 80 },
      { nodeId: 'b', x: 480, y: 80 },
      { nodeId: 'c', x: 880, y: 80 },
      { nodeId: 'd', x: 1280, y: 80 },
    ])
  })

  it('wraps after four default-width nodes', () => {
    const moves = arrangeCanvasNodes([
      node('a', 0, 0),
      node('b', 0, 0),
      node('c', 0, 0),
      node('d', 0, 0),
      node('e', 0, 0),
    ])
    expect(moves.slice(0, 4).map((move) => move.x)).toEqual([80, 480, 880, 1280])
    expect(moves[4]).toEqual({ nodeId: 'e', x: 80, y: 360 })
  })

  it('moves a group with its children and preserves relative positions', () => {
    const moves = arrangeCanvasNodes([
      node('solo', 0, 0),
      node('group', 100, 100, { type: 'group' }),
      node('child', 150, 150, { groupId: 'group' }),
    ])
    expect(moves).toEqual([
      { nodeId: 'solo', x: 80, y: 80 },
      { nodeId: 'group', x: 480, y: 80 },
      { nodeId: 'child', x: 530, y: 130 },
    ])
  })

  it('returns no moves when the layout is already settled', () => {
    expect(arrangeCanvasNodes([node('a', 80, 80), node('b', 480, 80)])).toEqual([])
  })

  it('treats orphaned group references as top-level nodes and does not mutate input', () => {
    const orphan = node('orphan', 0, 0, { groupId: 'missing' })
    const moves = arrangeCanvasNodes([orphan])
    expect(moves).toEqual([{ nodeId: 'orphan', x: 80, y: 80 }])
    expect(orphan.x).toBe(0)
    expect(orphan.y).toBe(0)
  })
})
