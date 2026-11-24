import { describe, expect, it } from 'vitest'
import { pointsBBox, strokePath } from './QuickAnnotationLayer'

describe('quick annotation geometry', () => {
  it('builds a closed svg path from points', () => {
    const path = strokePath(
      [
        [0, 0],
        [10, 10],
        [20, 0],
      ],
      4,
    )
    expect(path.startsWith('M')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
  })

  it('pads and clamps the bbox', () => {
    expect(
      pointsBBox(
        [
          [0, 0],
          [30, 40],
        ],
        4,
      ),
    ).toEqual({ x: 0, y: 0, w: 46, h: 56 })
  })

  it('never returns a zero-sized bbox', () => {
    const box = pointsBBox([[5, 5]], 2)
    expect(box.w).toBeGreaterThan(0)
    expect(box.h).toBeGreaterThan(0)
  })
})
