import { describe, expect, it } from 'vitest'
import { canvasOverviewXml, nodeSummary, nodeTitle } from '../src/supervisor/canvas-summary.js'

const artifact = {
  id: 'n1',
  canvasId: 'c1',
  type: 'artifact' as const,
  x: 0,
  y: 0,
  w: 320,
  h: 200,
  groupId: null,
  createdAt: 1,
  updatedAt: 1,
  data: {
    artifactId: 'a1',
    kind: 'spec' as const,
    title: '需求 spec',
    path: '.baton/deliveries/d1/requirement/spec.md',
    status: 'ready' as const,
  },
}
const drawing = {
  id: 'n2',
  canvasId: 'c1',
  type: 'drawing' as const,
  x: 0,
  y: 0,
  w: 320,
  h: 200,
  groupId: null,
  createdAt: 1,
  updatedAt: 1,
  data: { artifactId: 'a2', title: '线框图', status: 'ready' as const },
}

describe('canvas summary new node types', () => {
  it('titles artifact and drawing nodes', () => {
    expect(nodeTitle(artifact)).toBe('需求 spec')
    expect(nodeTitle(drawing)).toBe('线框图')
  })
  it('summarizes artifact without reading file content', () => {
    expect(nodeSummary(artifact)).toMatchObject({ type: 'artifact', title: '需求 spec' })
    expect(nodeSummary(artifact)).not.toHaveProperty('content')
  })
  it('renders overview without throwing', () => {
    expect(canvasOverviewXml([artifact, drawing], 1)).toContain('type="artifact"')
  })
})
