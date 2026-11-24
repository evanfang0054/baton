import { describe, expect, it } from 'vitest'
import {
  pointsBBox,
  selectionBBox,
  strokePath,
  textBBox,
  type QuickText,
} from './QuickAnnotationLayer'

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

  it('builds a bbox from text annotations without strokes', () => {
    const text: QuickText = { id: 't1', x: 40, y: 60, text: '按钮右对齐', color: 'var(--accent)' }
    expect(textBBox(text)).toMatchObject({ x: 40, y: 60, h: 34 })
    const box = selectionBBox([], [text])
    expect(box.x).toBeLessThanOrEqual(40)
    expect(box.y).toBeLessThanOrEqual(60)
    expect(box.w).toBeGreaterThanOrEqual(textBBox(text).w)
    expect(box.h).toBeGreaterThanOrEqual(34)
  })

  it('merges strokes and text into one annotation bbox', () => {
    const text: QuickText = {
      id: 't1',
      x: 200,
      y: 120,
      text: '这里要改',
      color: 'var(--foreground)',
    }
    const box = selectionBBox(
      [
        {
          tool: 'pen',
          color: 'var(--accent)',
          size: 4,
          points: [
            [0, 0],
            [30, 40],
          ],
        },
      ],
      [text],
    )
    expect(box.x).toBeLessThanOrEqual(0)
    expect(box.y).toBeLessThanOrEqual(0)
    expect(box.x + box.w).toBeGreaterThanOrEqual(200)
    expect(box.y + box.h).toBeGreaterThanOrEqual(120)
  })
})
