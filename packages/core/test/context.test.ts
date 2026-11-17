import { Edge, Node } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { assembleContext, isSensitivePath } from '../src/context/index.js'

const node = (
  id: string,
  type: Node['type'],
  data: unknown,
  x: number,
  y: number,
  groupId: string | null = null,
) =>
  Node.parse({
    id,
    canvasId: 'c1',
    type,
    data,
    x,
    y,
    groupId,
    createdAt: 1,
    updatedAt: 1,
  })

const edge = (id: string, sourceId: string, targetId: string) =>
  Edge.parse({ id, canvasId: 'c1', sourceId, targetId, type: 'context' })

const target = node('n4', 'agent', { title: 'Agent', engine: 'fake', taskId: null }, 0, 0)
const prd = node('n1', 'text', { content: 'PRD\n登录页需求：支持暗黑模式' }, 10, 10)
const design = node('n2', 'image', { src: 'artifacts/design.png', alt: '设计稿' }, 20, 20)
const spec = node('n3', 'file', { path: 'docs/login.md', name: 'login.md' }, 30, 30)
const review = node('n5', 'review', { taskId: 't1' }, 40, 40)
const group = node('n6', 'group', { label: '设计资料', collapsed: false }, 50, 50)
const childA = node('n7', 'text', { content: '分组内说明 A' }, 60, 60, 'n6')
const childB = node('n8', 'text', { content: '分组内说明 B' }, 70, 70, 'n6')

const nodes = [target, prd, design, spec, review, group, childA, childB]
const edges = [edge('e1', 'n1', 'n4'), edge('e2', 'n2', 'n1'), edge('e3', 'n5', 'n4')]

describe('assembleContext', () => {
  it('renders task + explicit/context nodes deterministically', () => {
    const result = assembleContext({
      taskPrompt: '把登录页改成暗黑模式',
      targetNodeId: 'n4',
      selectedNodeIds: ['n3', 'n6'],
      nodes,
      edges,
      contentByNodeId: { n3: '# 登录页规格\n使用暗色变量。' },
    })

    expect(result.prompt).toContain('<task>把登录页改成暗黑模式</task>')
    expect(result.prompt).toContain('<node id="n1" type="text" title="PRD">')
    expect(result.prompt).toContain('<node id="n3" type="file" title="login.md">')
    expect(result.prompt).toContain('使用暗色变量。')
    expect(result.prompt).toContain('分组内说明 A')
    expect(result.prompt).not.toContain('n5')
    expect(result.included.map((item) => item.id)).toEqual(['n1', 'n3', 'n7', 'n8', 'n2'])
    expect(result.dropped).toEqual([])

    const again = assembleContext({
      taskPrompt: '把登录页改成暗黑模式',
      targetNodeId: 'n4',
      selectedNodeIds: ['n3', 'n6'],
      nodes,
      edges,
      contentByNodeId: { n3: '# 登录页规格\n使用暗色变量。' },
    })
    expect(again).toEqual(result)
    expect(result.prompt).toMatchSnapshot()
  })

  it('detects sensitive paths', () => {
    expect(isSensitivePath('.env')).toBe(true)
    expect(isSensitivePath('config/.env.local')).toBe(true)
    expect(isSensitivePath('certs/server.pem')).toBe(true)
    expect(isSensitivePath('secrets/api-key.txt')).toBe(true)
    expect(isSensitivePath('src/index.ts')).toBe(false)
    expect(isSensitivePath('README.md')).toBe(false)
  })

  it('drops sensitive file content', () => {
    const secret = node('n9', 'file', { path: '.env', name: '.env' }, 0, 80)
    const result = assembleContext({
      taskPrompt: 'demo',
      targetNodeId: 'n4',
      selectedNodeIds: ['n9'],
      nodes: [...nodes, secret],
      edges,
      contentByNodeId: { n9: 'TOKEN=should-not-appear' },
    })
    expect(result.prompt).not.toContain('should-not-appear')
    expect(result.dropped).toContainEqual({ id: 'n9', reason: 'sensitive' })
    expect(result.redactedPaths).toContain('.env')
  })

  it('truncates over-budget content and marks the dropped nodes', () => {
    const a = node('n10', 'text', { content: 'a'.repeat(50) }, 0, 90)
    const b = node('n11', 'text', { content: 'b'.repeat(50) }, 0, 100)
    const result = assembleContext({
      taskPrompt: 'demo',
      targetNodeId: 'n4',
      selectedNodeIds: ['n10', 'n11'],
      nodes: [...nodes, a, b],
      edges,
      maxChars: 60,
    })
    expect(result.truncated).toBe(true)
    expect(result.prompt).toContain('<truncated nodes="')
    expect(result.included.length + result.dropped.length).toBeGreaterThan(0)
  })

  it('drops missing and empty nodes with reasons', () => {
    const empty = node('n12', 'text', { content: '' }, 0, 110)
    const result = assembleContext({
      taskPrompt: 'demo',
      targetNodeId: 'n4',
      selectedNodeIds: ['n12', 'missing'],
      nodes: [...nodes, empty],
      edges,
    })
    expect(result.dropped).toContainEqual({ id: 'n12', reason: 'empty' })
    expect(result.dropped).toContainEqual({ id: 'missing', reason: 'not_found' })
  })

  it('drops the target, deduplicates missing ids, and handles an empty budget', () => {
    const result = assembleContext({
      taskPrompt: 'demo',
      targetNodeId: 'n4',
      selectedNodeIds: ['n4', 'missing', 'missing'],
      nodes,
      edges,
      maxChars: 0,
    })
    expect(result.dropped).toContainEqual({ id: 'n4', reason: 'target' })
    expect(result.dropped.filter((item) => item.id === 'missing')).toHaveLength(1)
    expect(result.prompt).toContain('<context></context>')
    expect(result.truncated).toBe(true)
  })

  it('falls back to file paths and omits a missing image alt', () => {
    const file = node('n20', 'file', { path: 'docs/a.md', name: 'a.md' }, 0, 120)
    const image = node('n21', 'image', { src: 'artifacts/b.png' }, 0, 130)
    const result = assembleContext({
      taskPrompt: 'demo',
      targetNodeId: 'n4',
      selectedNodeIds: ['n20', 'n21'],
      nodes: [...nodes, file, image],
      edges,
    })
    expect(result.prompt).toContain('<node id="n20" type="file" title="a.md">docs/a.md</node>')
    expect(result.prompt).toContain('<image src="artifacts/b.png"/>')
  })

  it('marks per-node truncation', () => {
    const long = node('n22', 'text', { content: 'x'.repeat(20) }, 0, 140)
    const result = assembleContext({
      taskPrompt: 'demo',
      targetNodeId: 'n4',
      selectedNodeIds: ['n22'],
      nodes: [...nodes, long],
      edges,
      maxNodeChars: 5,
    })
    expect(result.prompt).toContain('truncated="true"')
    expect(result.truncated).toBe(true)
  })

  it('stops at depth 2 and ignores non-content upstream nodes', () => {
    const depth3 = node('d0', 'text', { content: 'depth3' }, 0, 0)
    const depth2 = node('d1', 'text', { content: 'depth2' }, 0, 1)
    const depth1 = node('d2', 'text', { content: 'depth1' }, 0, 2)
    const selected = node('d3', 'text', { content: 'selected' }, 0, 3)
    const otherAgent = node('a1', 'agent', { title: 'Other', engine: 'fake', taskId: null }, 0, 4)
    const otherReview = node('r1', 'review', { taskId: 't2' }, 0, 5)
    const otherGroup = node('g1', 'group', { label: 'G2', collapsed: false }, 0, 6)
    const deepEdges = [
      edge('x1', 'd2', 'd3'),
      edge('x2', 'd1', 'd2'),
      edge('x3', 'd0', 'd1'),
      edge('x4', 'a1', 'd3'),
      edge('x5', 'r1', 'd3'),
      edge('x6', 'g1', 'd3'),
      edge('x7', 'gone', 'd3'),
    ]
    const result = assembleContext({
      taskPrompt: 'demo',
      targetNodeId: 'n4',
      selectedNodeIds: ['d3'],
      nodes: [...nodes, depth3, depth2, depth1, selected, otherAgent, otherReview, otherGroup],
      edges: deepEdges,
    })
    expect(result.prompt).toContain('depth1')
    expect(result.prompt).toContain('depth2')
    expect(result.prompt).not.toContain('depth3')
    expect(result.prompt).not.toContain('Other')
    expect(result.prompt).not.toContain('r1')
    expect(result.dropped).toContainEqual({ id: 'gone', reason: 'not_found' })
  })

  it('limits the closure to 40 nodes', () => {
    const many = Array.from({ length: 45 }, (_, index) =>
      node(`m${index}`, 'text', { content: `m${index}` }, index, 0),
    )
    const result = assembleContext({
      taskPrompt: 'demo',
      targetNodeId: 'n4',
      selectedNodeIds: many.map((item) => item.id),
      nodes: [...nodes, ...many],
      edges,
    })
    expect(result.included).toHaveLength(40)
    expect(result.dropped.some((item) => item.reason === 'limit')).toBe(true)
  })
})
