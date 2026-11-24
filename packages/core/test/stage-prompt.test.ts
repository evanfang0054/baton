import { describe, expect, it } from 'vitest'
import { annotationRegion, buildAnnotationBlock } from '../src/annotation/block.js'
import { buildStagePrompt } from '../src/delivery/prompt.js'

const annotation = {
  id: 'an1',
  deliveryId: 'd1',
  stageKey: 'design',
  targetNodeIds: ['n1'],
  targetArtifactId: null,
  note: '按钮右对齐 & 保留间距',
  bbox: { x: 10, y: 20, w: 100, h: 40 },
  imagePath: '.baton/deliveries/d1/design/annotations/an1.png',
  status: 'open' as const,
  taskId: null,
  createdAt: 1,
}

describe('buildAnnotationBlock', () => {
  it('escapes note and keeps image path', () => {
    const block = buildAnnotationBlock([annotation])
    expect(block).toContain('按钮右对齐 &amp; 保留间距')
    expect(block).toContain('<image src=".baton/deliveries/d1/design/annotations/an1.png"/>')
    expect(block).not.toContain('strokes')
  })

  it('includes the target region when available', () => {
    const block = buildAnnotationBlock([
      {
        ...annotation,
        targetTitle: 'WjCVynRceo8.jpg',
        targetRegion: { x: 10, y: 20, w: 30, h: 40 },
      },
    ])
    expect(block).toContain('target="WjCVynRceo8.jpg"')
    expect(block).toContain('region="10,20,30,40"')
  })
})

describe('annotationRegion', () => {
  it('returns percentages relative to the target node', () => {
    expect(
      annotationRegion({ x: 120, y: 240, w: 40, h: 20 }, { x: 100, y: 200, w: 200, h: 100 }),
    ).toEqual({ x: 10, y: 40, w: 20, h: 20 })
  })

  it('returns null when the bbox misses the node', () => {
    expect(
      annotationRegion({ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 100, w: 50, h: 50 }),
    ).toBeNull()
  })
})

describe('buildStagePrompt', () => {
  it('renders delivery, stage, produces, previous, skill and annotations', () => {
    const prompt = buildStagePrompt({
      delivery: { id: 'd1', title: '优惠券领取页', goal: '做一个领取页' },
      stage: { key: 'design', label: '设计', gate: 'human', ordinal: 2 },
      produces: [
        {
          kind: 'prototype',
          name: 'prototype.html',
          path: '.baton/deliveries/d1/design/prototype.html',
          required: true,
        },
      ],
      acceptance: { checklist: ['按钮右对齐'], verify: true },
      previous: [
        {
          stageKey: 'requirement',
          artifacts: [
            {
              kind: 'spec',
              name: 'spec.md',
              path: '.baton/deliveries/d1/requirement/spec.md',
              required: true,
            },
          ],
        },
      ],
      skill: {
        id: 'hi-fi-design',
        path: '.baton/skills/hi-fi-design/SKILL.md',
        summary: '高保真设计',
      },
      annotations: [annotation],
    })
    expect(prompt).toContain('<delivery id="d1" title="优惠券领取页">')
    expect(prompt).toContain('<stage key="design"')
    expect(prompt).toContain('<skill id="hi-fi-design"')
    expect(prompt).toContain('<annotation id="an1"')
  })
})
