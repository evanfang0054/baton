import { describe, expect, it } from 'vitest'
import { buildAnnotationBlock } from '../src/annotation/block.js'
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
