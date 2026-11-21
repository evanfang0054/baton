import { describe, expect, it } from 'vitest'
import { findContainingGroup, groupBounds } from '../src/canvas/grouping.js'

const small = { id: 'g1', x: 0, y: 0, w: 200, h: 200 }
const large = { id: 'g2', x: -50, y: -50, w: 400, h: 400 }

describe('grouping geometry', () => {
  it('uses node center and picks the smallest overlapping group', () => {
    expect(findContainingGroup({ x: 10, y: 10, w: 20, h: 20 }, [large, small])?.id).toBe('g1')
    expect(findContainingGroup({ x: 360, y: 360, w: 20, h: 20 }, [large, small])).toBeNull()
  })

  it('computes padded bounds', () => {
    expect(groupBounds([{ x: 10, y: 20, w: 100, h: 50 }], 24)).toEqual({
      x: -14,
      y: -4,
      w: 148,
      h: 98,
    })
  })

  it('uses the center, not the top-left corner', () => {
    const outside = { id: 'g3', x: 100, y: 100, w: 100, h: 100 }
    expect(findContainingGroup({ x: 90, y: 90, w: 10, h: 10 }, [outside])).toBeNull()
  })
})
