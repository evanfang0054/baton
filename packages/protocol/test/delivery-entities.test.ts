import { describe, expect, it } from 'vitest'
import { Annotation, AnnotationSummary, Artifact, Playbook } from '../src/index.js'

describe('artifact entity', () => {
  it('parses a drawing artifact with editable source', () => {
    const artifact = Artifact.parse({
      id: 'a1',
      workspaceId: 'w1',
      deliveryId: 'd1',
      stageKey: 'design',
      taskId: null,
      kind: 'drawing',
      name: 'wireframe',
      path: '.baton/deliveries/d1/design/wireframe.png',
      sourcePath: '.baton/deliveries/d1/design/wireframe.excalidraw',
      svgPath: null,
      mime: 'image/png',
      size: 1024,
      sha256: 'abc',
      version: 1,
      status: 'ready',
      createdAt: 1,
      updatedAt: 1,
    })
    expect(artifact.kind).toBe('drawing')
    expect(artifact.sourcePath).toContain('.excalidraw')
  })

  it('rejects unknown artifact kind', () => {
    expect(
      Artifact.safeParse({
        id: 'a1',
        workspaceId: 'w1',
        deliveryId: 'd1',
        stageKey: 'design',
        taskId: null,
        kind: 'video',
        name: 'x',
        path: 'x',
        sourcePath: null,
        svgPath: null,
        mime: null,
        size: 0,
        sha256: 'x',
        version: 1,
        status: 'draft',
        createdAt: 1,
        updatedAt: 1,
      }).success,
    ).toBe(false)
  })
})

describe('annotation entity', () => {
  it('summarizes without strokes', () => {
    const annotation = Annotation.parse({
      id: 'an1',
      workspaceId: 'w1',
      deliveryId: 'd1',
      stageKey: 'design',
      targetNodeIds: ['n1'],
      targetArtifactId: null,
      note: '按钮右对齐',
      strokesJson: '[]',
      bbox: { x: 0, y: 0, w: 10, h: 10 },
      imagePath: '.baton/deliveries/d1/design/annotations/an1.png',
      status: 'open',
      taskId: null,
      createdAt: 1,
      updatedAt: 1,
      resolvedAt: null,
    })
    const summary = AnnotationSummary.parse(annotation)
    expect(summary.note).toBe('按钮右对齐')
    expect('strokesJson' in summary).toBe(false)
  })

  it('rejects note over 2000 chars', () => {
    expect(
      Annotation.safeParse({
        id: 'an1',
        workspaceId: 'w1',
        deliveryId: 'd1',
        stageKey: 'design',
        targetNodeIds: [],
        targetArtifactId: null,
        note: 'x'.repeat(2001),
        strokesJson: '[]',
        bbox: { x: 0, y: 0, w: 10, h: 10 },
        imagePath: 'x',
        status: 'open',
        taskId: null,
        createdAt: 1,
        updatedAt: 1,
        resolvedAt: null,
      }).success,
    ).toBe(false)
  })
})

describe('playbook entity', () => {
  it('parses the standard four stages', () => {
    const playbook = Playbook.parse({
      id: 'standard-delivery',
      version: 1,
      label: '标准交付',
      stages: [
        {
          key: 'requirement',
          label: '需求',
          skill: 'requirement-grooming',
          gate: 'human',
          produces: [{ kind: 'spec', name: 'spec.md', required: true }],
        },
        {
          key: 'design',
          label: '设计',
          skill: 'hi-fi-design',
          gate: 'human',
          produces: [{ kind: 'prototype', name: 'prototype.html' }],
        },
        {
          key: 'build',
          label: '开发',
          skill: 'implement',
          gate: 'auto',
          produces: [{ kind: 'report', name: 'build-report.md' }],
        },
        {
          key: 'acceptance',
          label: '验收',
          skill: 'acceptance',
          gate: 'human',
          produces: [{ kind: 'report', name: 'acceptance.md' }],
        },
      ],
    })
    expect(playbook.stages).toHaveLength(4)
    expect(playbook.stages[0]?.acceptance.verify).toBe(true)
  })

  it('rejects unknown gate', () => {
    expect(
      Playbook.safeParse({
        id: 'x',
        version: 1,
        label: 'x',
        stages: [{ key: 'a', label: 'A', gate: 'auto-magic' }],
      }).success,
    ).toBe(false)
  })
})
