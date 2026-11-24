import { describe, expect, it } from 'vitest'
import { drawingSummary, extractDrawingContent } from '../src/drawing/scene.js'

function fixture() {
  return {
    type: 'excalidraw',
    version: 2,
    elements: [
      { id: 't2', type: 'text', x: 20, y: 20, width: 100, height: 20, text: '第二条' },
      { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 },
      { id: 't1', type: 'text', x: 10, y: 10, width: 100, height: 20, text: '第一条' },
      { id: 'a1', type: 'arrow', x: 0, y: 100, width: 50, height: 0 },
      { id: 'i1', type: 'image', x: 200, y: 200, width: 50, height: 50 },
      { id: 'f1', type: 'freedraw', x: 300, y: 300, width: 20, height: 20 },
      { id: 'd1', type: 'text', x: 0, y: 0, width: 10, height: 10, text: '删除', isDeleted: true },
    ],
  }
}

describe('extractDrawingContent', () => {
  it('extracts texts in reading order and counts element types', () => {
    const content = extractDrawingContent(fixture())
    expect(content.texts.map((text) => text.text)).toEqual(['第一条', '第二条'])
    expect(content.elements).toHaveLength(6)
    expect(content.counts).toMatchObject({
      text: 2,
      rectangle: 1,
      arrow: 1,
      image: 1,
      freedraw: 1,
    })
    expect(content.totalElements).toBe(6)
    expect(content.totalTexts).toBe(2)
    expect(content.bounds).toEqual({ minX: 0, minY: 0, maxX: 320, maxY: 320 })
    expect(content.truncated).toBe(false)
  })

  it('accepts an elements array and ignores malformed input', () => {
    expect(extractDrawingContent(fixture().elements).texts).toHaveLength(2)
    for (const input of [null, undefined, 'nope', {}, { elements: 'nope' }]) {
      expect(extractDrawingContent(input)).toMatchObject({
        elements: [],
        texts: [],
        bounds: null,
        truncated: false,
      })
    }
  })

  it('caps elements and text characters with a truncated marker', () => {
    const many = Array.from({ length: 5001 }, (_, index) => ({
      id: `r-${index}`,
      type: 'rectangle',
      x: index,
      y: 0,
      width: 1,
      height: 1,
    }))
    const byElement = extractDrawingContent({ elements: many })
    expect(byElement.elements).toHaveLength(5000)
    expect(byElement.totalElements).toBe(5001)
    expect(byElement.truncated).toBe(true)

    const huge = extractDrawingContent({
      elements: [{ id: 't', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'x'.repeat(200_001) }],
    })
    expect(huge.texts[0]?.text).toHaveLength(200_000)
    expect(huge.truncated).toBe(true)
  })
})

describe('drawingSummary', () => {
  it('returns the first three texts and image count', () => {
    const summary = drawingSummary(fixture())
    expect(summary.summary).toBe('第一条 / 第二条')
    expect(summary.textCount).toBe(2)
    expect(summary.imageCount).toBe(1)
  })
})
