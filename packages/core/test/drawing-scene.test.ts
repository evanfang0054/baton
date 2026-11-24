import { describe, expect, it } from 'vitest'
import {
  applyDrawingOperations,
  createEmptyScene,
  DrawingOperationError,
  drawingSummary,
  extractDrawingContent,
} from '../src/drawing/scene.js'

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
      elements: [
        { id: 't', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'x'.repeat(200_001) },
      ],
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

describe('applyDrawingOperations', () => {
  function ids() {
    let index = 0
    return () => `n-${++index}`
  }

  it('adds labeled shapes, arrows and images with Excalidraw bindings', () => {
    const scene = applyDrawingOperations(
      createEmptyScene(),
      [
        {
          op: 'add_shape',
          shape: 'rectangle',
          id: 'box',
          x: 10,
          y: 10,
          w: 200,
          h: 100,
          text: '入口',
        },
        { op: 'add_shape', shape: 'ellipse', id: 'oval', x: 300, y: 10, w: 120, h: 80 },
        { op: 'add_arrow', id: 'arrow', x: 210, y: 60, w: 90, h: 0, fromId: 'box', toId: 'oval' },
        {
          op: 'add_image',
          id: 'img',
          path: 'assets/shot.png',
          x: 10,
          y: 180,
          image: {
            dataURL: 'data:image/png;base64,AA==',
            mimeType: 'image/png',
            width: 40,
            height: 30,
          },
        },
      ],
      { newId: ids(), now: 100 },
    )

    expect(scene.elements.map((element) => element.id)).toEqual([
      'box',
      'n-1',
      'oval',
      'arrow',
      'img',
    ])
    const box = scene.elements.find((element) => element.id === 'box')
    expect(box?.boundElements).toEqual([
      { id: 'n-1', type: 'text' },
      { id: 'arrow', type: 'arrow' },
    ])
    const label = scene.elements.find((element) => element.id === 'n-1')
    expect(label).toMatchObject({ type: 'text', text: '入口', containerId: 'box' })
    expect(scene.elements.find((element) => element.id === 'arrow')).toMatchObject({
      type: 'arrow',
      startBinding: { elementId: 'box' },
      endBinding: { elementId: 'oval' },
    })
    expect(scene.files).toHaveProperty('n-2-file')
    const content = extractDrawingContent(scene)
    expect(content.counts).toMatchObject({ rectangle: 1, ellipse: 1, arrow: 1, image: 1, text: 1 })
    expect(content.texts.map((text) => text.text)).toEqual(['入口'])
  })

  it('updates labels and moves bound text with the shape', () => {
    const scene = applyDrawingOperations(
      createEmptyScene(),
      [
        {
          op: 'add_shape',
          shape: 'rectangle',
          id: 'box',
          x: 10,
          y: 10,
          w: 200,
          h: 100,
          text: '旧标题',
        },
        { op: 'move_element', id: 'box', x: 60, y: 40 },
        { op: 'update_text', id: 'n-1', text: '新标题' },
      ],
      { newId: ids(), now: 100 },
    )
    const texts = extractDrawingContent(scene).texts
    expect(texts[0]?.text).toBe('新标题')
    expect(texts[0]?.x).toBeGreaterThan(60)
    expect(texts[0]?.y).toBeGreaterThan(40)
  })

  it('soft deletes shapes and their labels', () => {
    const scene = applyDrawingOperations(
      createEmptyScene(),
      [
        { op: 'add_shape', shape: 'rectangle', id: 'box', x: 0, y: 0, w: 100, h: 50, text: '删掉' },
        { op: 'delete_elements', ids: ['box'] },
      ],
      { newId: ids(), now: 100 },
    )
    expect(scene.elements.every((element) => element.isDeleted === true)).toBe(true)
    expect(extractDrawingContent(scene).elements).toHaveLength(0)
  })

  it('enforces element and text limits and invalid references', () => {
    expect(() =>
      applyDrawingOperations(createEmptyScene(), [{ op: 'delete_elements', ids: ['missing'] }], {
        newId: ids(),
        now: 1,
      }),
    ).toThrow(DrawingOperationError)

    expect(() =>
      applyDrawingOperations(
        createEmptyScene(),
        [
          { op: 'add_text', x: 0, y: 0, text: 'a' },
          { op: 'add_text', x: 0, y: 30, text: 'b' },
        ],
        { newId: ids(), now: 1, limits: { maxElements: 1 } },
      ),
    ).toThrowError(/too many elements/)

    expect(() =>
      applyDrawingOperations(createEmptyScene(), [{ op: 'add_text', x: 0, y: 0, text: 'hello' }], {
        newId: ids(),
        now: 1,
        limits: { maxTextChars: 3 },
      }),
    ).toThrowError(/text is too large/)
  })

  it('supports line, freedraw, style, move, resize and multi-delete', () => {
    const scene = applyDrawingOperations(
      createEmptyScene(),
      [
        { op: 'add_line', id: 'line', x: 0, y: 0, w: 100, h: 0 },
        {
          op: 'add_freedraw',
          id: 'free',
          x: 200,
          y: 200,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 30 },
          ],
        },
        { op: 'add_shape', shape: 'rectangle', id: 'box', x: 20, y: 20, w: 100, h: 60, text: '旧' },
        { op: 'set_style', id: 'box', strokeColor: '#ff0000', strokeWidth: 4, opacity: 50 },
        { op: 'move_element', id: 'box', dx: 10, dy: 10 },
        { op: 'resize_element', id: 'box', w: 200, h: 120 },
        { op: 'update_text', id: 'n-1', text: '新' },
        { op: 'delete_elements', ids: ['line', 'free'] },
      ],
      { newId: ids(), now: 100 },
    )
    expect(scene.elements.find((element) => element.id === 'box')).toMatchObject({
      x: 30,
      y: 30,
      width: 200,
      height: 120,
      strokeColor: '#ff0000',
      strokeWidth: 4,
      opacity: 50,
    })
    expect(scene.elements.find((element) => element.id === 'n-1')).toMatchObject({ text: '新' })
    expect(scene.elements.find((element) => element.id === 'line')?.isDeleted).toBe(true)
    expect(scene.elements.find((element) => element.id === 'free')?.isDeleted).toBe(true)
  })

  it('rejects more than 50 operations', () => {
    const operations = Array.from({ length: 51 }, (_, index) => ({
      op: 'add_text' as const,
      x: index,
      y: 0,
      text: 'x',
    }))
    expect(() =>
      applyDrawingOperations(createEmptyScene(), operations, { newId: ids(), now: 1 }),
    ).toThrowError(/too many operations/)
  })

  it('rejects writes beyond 500 elements', () => {
    const existing = {
      type: 'excalidraw',
      version: 2,
      elements: Array.from({ length: 500 }, (_, index) => ({
        id: `r-${index}`,
        type: 'rectangle',
        x: index,
        y: 0,
        width: 1,
        height: 1,
      })),
    }
    expect(() =>
      applyDrawingOperations(existing, [{ op: 'add_text', x: 0, y: 0, text: '超出' }], {
        newId: ids(),
        now: 1,
      }),
    ).toThrowError(/too many elements/)
  })

  it('prunes unreferenced image files and caps images at 20', () => {
    const image = {
      dataURL: 'data:image/png;base64,AA==',
      mimeType: 'image/png',
      width: 10,
      height: 10,
    }
    const scene = applyDrawingOperations(
      createEmptyScene(),
      [
        { op: 'add_image', id: 'img1', path: 'a.png', x: 0, y: 0, image },
        { op: 'delete_elements', ids: ['img1'] },
      ],
      { newId: ids(), now: 1 },
    )
    expect(scene.files).toEqual({})

    const many = Array.from({ length: 21 }, (_, index) => ({
      op: 'add_image' as const,
      path: `img-${index}.png`,
      x: index,
      y: 0,
      image,
    }))
    expect(() =>
      applyDrawingOperations(createEmptyScene(), many, { newId: ids(), now: 1 }),
    ).toThrowError(/too many images/)
  })
})
