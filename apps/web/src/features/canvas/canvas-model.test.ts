import type {
  Edge as ProtocolEdge,
  Node as ProtocolNode,
  ReviewView,
  TaskSummary,
} from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import {
  dropPatch,
  groupMovePlan,
  isValidConnection,
  mergeFlowNodes,
  nextNodePosition,
  resolveImageUrl,
  toFlowEdges,
  toFlowNodes,
} from './model'

const textNode: ProtocolNode = {
  id: 'n1',
  canvasId: 'c1',
  type: 'text',
  x: 10,
  y: 20,
  w: 320,
  h: 200,
  groupId: null,
  data: { content: 'hello' },
  createdAt: 1,
  updatedAt: 1,
}

const agentNode: ProtocolNode = {
  id: 'n2',
  canvasId: 'c1',
  type: 'agent',
  x: 50,
  y: 60,
  w: 320,
  h: 200,
  groupId: null,
  data: { title: 'Agent 1', engine: 'fake', taskId: null },
  createdAt: 1,
  updatedAt: 1,
}

const task: TaskSummary = {
  id: 't1',
  workspaceId: 'w1',
  nodeId: 'n2',
  title: '任务',
  prompt: '',
  status: 'todo',
  waitingReason: null,
  engine: 'fake',
  workspaceMode: 'main',
  branch: null,
  worktreePath: null,
  verifyCommand: null,
  dangerouslySkipPermissions: false,
  budgetUsd: null,
  enqueuedAt: null,
  retryCount: 0,
  createdAt: 1,
  updatedAt: 1,
  attention: 'none',
  waitingSince: null,
  acceptance: null,
  budget: null,
}

const review: ReviewView = {
  id: 'r1',
  taskId: 't1',
  verdict: null,
  verifyExitCode: 0,
  verifyOutput: 'ok',
  diffStat: { filesChanged: 2, insertions: 5, deletions: 1 },
  decidedAt: null,
  preliminaryVerdict: 'pass',
  preliminaryReason: '检查通过',
  preliminaryAt: 10,
  diffAvailable: true,
}

function groupNode(id: string, collapsed = false, x = 0, y = 0): ProtocolNode {
  return {
    id,
    canvasId: 'c1',
    type: 'group',
    x,
    y,
    w: 400,
    h: 300,
    groupId: null,
    data: { label: '需求区', collapsed },
    createdAt: 1,
    updatedAt: 1,
  }
}

function imageNode(id: string, src: string): ProtocolNode {
  return {
    ...textNode,
    id,
    type: 'image',
    data: { src, alt: '图' },
  }
}

describe('canvas model', () => {
  it('maps protocol nodes to flow nodes with size and task', () => {
    const flow = toFlowNodes([textNode, agentNode], [task])
    expect(flow[0]).toMatchObject({
      id: 'n1',
      type: 'text',
      position: { x: 10, y: 20 },
      style: { width: 320, height: 200 },
      data: { node: textNode, task: null },
    })
    expect(flow[1]?.data.task).toEqual(task)
  })

  it('marks injected nodes from the injected id set', () => {
    const flow = toFlowNodes([textNode, groupNode('g1')], [], {
      injectedNodeIds: new Set([textNode.id, 'g1']),
    })
    expect(flow.find((node) => node.id === textNode.id)?.data.injected).toBe(true)
    expect(flow.find((node) => node.id === 'g1')?.data.injected).toBe(true)
    expect(toFlowNodes([textNode], [])[0]?.data.injected).toBe(false)
  })

  it('shows the newest task when an agent has task history', () => {
    const older: TaskSummary = { ...task, id: 't0', status: 'done', createdAt: 1 }
    const newer: TaskSummary = { ...task, id: 't2', createdAt: 2 }
    const flow = toFlowNodes([agentNode], [newer, older])
    expect(flow[0]?.data.task?.id).toBe('t2')
  })

  it('maps image, group and derived review nodes', () => {
    const image = imageNode('n3', 'https://example.com/a.png')
    const flow = toFlowNodes([image, groupNode('g1')], [])
    expect(flow.find((node) => node.id === 'n3')?.type).toBe('image')
    expect(flow.find((node) => node.id === 'g1')).toMatchObject({
      type: 'group',
      style: { width: 400, height: 300 },
      data: { childCount: 0 },
    })
  })

  it('carries acceptance and budget onto the review card', () => {
    const reviewTask: TaskSummary = {
      ...task,
      status: 'review',
      attention: 'needs_review',
      acceptance: {
        contractId: 'ac1',
        version: 1,
        revision: 0,
        status: 'draft',
        counts: { total: 3, pass: 2, fail: 1, pending: 0, waived: 0 },
        verdict: 'fail',
        topFailures: [{ text: '深链参数未校验', evidence: null }],
      },
      budget: {
        budgetUsd: 2,
        spentUsd: 1.2,
        remainingUsd: 0.8,
        ratio: 0.6,
        overBudget: false,
        nearBudget: false,
        workerCostUsd: 1.2,
        verifierCostUsd: 0,
        turns: 2,
      },
    }
    const card = toFlowNodes([agentNode], [reviewTask], {
      reviewDetails: { t1: review },
    }).find((node) => node.id === 'review:t1')
    expect(card?.data).toMatchObject({
      acceptance: { counts: { pass: 2, total: 3, fail: 1 } },
      budget: { spentUsd: 1.2, budgetUsd: 2 },
    })
  })

  it('adds a derived review card for review tasks', () => {
    const flow = toFlowNodes([agentNode], [task], {
      reviewDetails: { t1: review },
      workspaceId: 'w1',
    })
    const reviewTask = { ...task, status: 'review' as const, attention: 'needs_review' as const }
    const withCard = toFlowNodes([agentNode], [reviewTask], {
      reviewDetails: { t1: review },
      workspaceId: 'w1',
    })
    const card = withCard.find((node) => node.id === 'review:t1')
    expect(card).toMatchObject({
      type: 'review',
      draggable: false,
      selectable: false,
      connectable: false,
      position: { x: 410, y: 60 },
      data: { task: reviewTask, review },
    })
    expect(card?.data.node.type).toBe('review')
    expect(flow.some((node) => node.id === 'review:t1')).toBe(false)
  })

  it('dims unrelated nodes and hides collapsed group children unless scene expands group', () => {
    const child: ProtocolNode = { ...textNode, id: 'n1', groupId: 'g1', x: 110, y: 120 }
    const nodes = [agentNode, child, groupNode('g1', true)]
    const scene = {
      taskId: 't1',
      relatedNodeIds: ['n2', 'n1'],
      relatedGroupIds: ['g1'],
      relatedEdgeIds: [],
      expandGroupIds: ['g1'],
      missingNodeIds: [],
      showReviewCard: false,
      reviewCardPosition: { x: 0, y: 0 },
    }
    const flow = toFlowNodes(nodes, [], { scene })
    expect(flow.find((node) => node.id === 'n2')?.data.dimmed).toBe(false)
    expect(flow.find((node) => node.id === 'n1')).toMatchObject({
      position: { x: 110, y: 120 },
      parentId: 'g1',
      hidden: false,
      data: { dimmed: false },
    })
    expect(flow.find((node) => node.id === 'g1')?.data.dimmed).toBe(false)

    const collapsed = toFlowNodes(nodes, [], {
      scene: { ...scene, expandGroupIds: [] },
    })
    expect(collapsed.find((node) => node.id === 'n1')?.hidden).toBe(true)
  })

  it('resolves local image URL and keeps external URL', () => {
    const flow = toFlowNodes(
      [imageNode('i1', '.baton/uploads/a.png'), imageNode('i2', 'https://example.com/b.png')],
      [],
      { workspaceId: 'w1' },
    )
    expect(flow[0]?.data.imageUrl).toBe('/api/workspaces/w1/uploads/a.png')
    expect(flow[1]?.data.imageUrl).toBe('https://example.com/b.png')
    expect(resolveImageUrl('.baton/uploads/a.png')).toBeUndefined()
    expect(resolveImageUrl('http://example.com/a.png')).toBeUndefined()
    expect(resolveImageUrl('data:image/png;base64,aaa')).toBeUndefined()
    expect(resolveImageUrl('//example.com/a.png')).toBeUndefined()
  })

  it('maps protocol edges to mutable flow edges', () => {
    const edges = toFlowEdges([
      { id: 'e1', canvasId: 'c1', sourceId: 'n1', targetId: 'n2', type: 'context' },
    ])
    expect(edges[0]).toMatchObject({
      id: 'e1',
      source: 'n1',
      target: 'n2',
      selectable: true,
      focusable: true,
      deletable: true,
    })
  })

  it('hides edges touching collapsed group children', () => {
    const edges = toFlowEdges(
      [
        { id: 'e1', canvasId: 'c1', sourceId: 'n1', targetId: 'n2', type: 'context' },
        { id: 'e2', canvasId: 'c1', sourceId: 'n2', targetId: 'n3', type: 'context' },
      ],
      null,
      new Set(['n1']),
    )
    expect(edges.map((edge) => edge.id)).toEqual(['e2'])
  })

  it('rejects self loops, duplicates and empty endpoints', () => {
    const edges: ProtocolEdge[] = [
      { id: 'e1', canvasId: 'c1', sourceId: 'n1', targetId: 'n2', type: 'context' },
    ]
    expect(isValidConnection({ source: 'n1', target: 'n1' }, edges)).toBe(false)
    expect(isValidConnection({ source: 'n1', target: 'n2' }, edges)).toBe(false)
    expect(isValidConnection({ source: null, target: 'n2' }, edges)).toBe(false)
    expect(isValidConnection({ source: 'n1', target: null }, edges)).toBe(false)
  })

  it('allows the reverse direction and new pairs', () => {
    const edges: ProtocolEdge[] = [
      { id: 'e1', canvasId: 'c1', sourceId: 'n1', targetId: 'n2', type: 'context' },
    ]
    expect(isValidConnection({ source: 'n2', target: 'n1' }, edges)).toBe(true)
    expect(isValidConnection({ source: 'n1', target: 'n3' }, edges)).toBe(true)
  })

  it('keeps the local position of a node that is being dragged', () => {
    const incoming = toFlowNodes([textNode], [])
    const dragging = {
      ...incoming[0]!,
      position: { x: 99, y: 88 },
      dragging: true,
      selected: true,
    }
    const merged = mergeFlowNodes([dragging], toFlowNodes([{ ...textNode, x: 0, y: 0 }], []))
    expect(merged[0]?.position).toEqual({ x: 99, y: 88 })
    expect(merged[0]?.selected).toBe(true)
  })

  it('plans a group move with absolute child coordinates', () => {
    const child: ProtocolNode = { ...textNode, id: 'n1', groupId: 'g1', x: 10, y: 20 }
    const flow = toFlowNodes([groupNode('g1'), child], [])
    const group = flow.find((node) => node.id === 'g1')!
    const moved = { ...group, position: { x: 100, y: 100 } }
    const current = flow.map((node) => (node.id === 'g1' ? moved : node))
    expect(groupMovePlan(moved, current)).toEqual([
      { nodeId: 'g1', x: 100, y: 100 },
      { nodeId: 'n1', x: 110, y: 120 },
    ])
  })

  it('resolves the target group from the drop center', () => {
    const flow = toFlowNodes([groupNode('g1'), textNode], [])
    const node = flow.find((item) => item.id === 'n1')!
    expect(dropPatch(node, flow, [groupNode('g1'), textNode])).toEqual({
      x: 10,
      y: 20,
      groupId: 'g1',
    })

    const outside = { ...node, position: { x: 900, y: 900 } }
    expect(dropPatch(outside, flow, [groupNode('g1'), textNode]).groupId).toBeNull()
  })

  it('applies the server position once the drag has stopped', () => {
    const current = toFlowNodes([textNode], [])
    const merged = mergeFlowNodes(current, toFlowNodes([{ ...textNode, x: 5, y: 6 }], []))
    expect(merged[0]?.position).toEqual({ x: 5, y: 6 })
  })

  it('places new nodes around the center without overlapping', () => {
    const size = { w: 320, h: 200 }
    const center = { x: 500, y: 400 }
    const first = nextNodePosition(center, size, [])
    expect(first).toEqual({ x: 340, y: 300 })

    const second = nextNodePosition(center, size, [{ ...first, ...size }])
    expect(second).toEqual({ x: 684, y: 300 })

    const third = nextNodePosition(center, size, [
      { ...first, ...size },
      { ...second, ...size },
    ])
    expect(third).toEqual({ x: -4, y: 300 })
  })

  it('falls back to a new row when all center columns are occupied', () => {
    const size = { w: 320, h: 200 }
    const center = { x: 500, y: 400 }
    const occupied = [0, 1, -1, 2, -2].map((column) => ({
      x: 340 + column * 344,
      y: 300,
      ...size,
    }))
    expect(nextNodePosition(center, size, occupied)).toEqual({ x: 340, y: 524 })
  })

  it('skips slots outside the visible canvas', () => {
    const size = { w: 320, h: 200 }
    const center = { x: 500, y: 400 }
    const bounds = { minX: 100, minY: 100, maxX: 1100, maxY: 800 }
    const first = nextNodePosition(center, size, [], 24, bounds)
    const second = nextNodePosition(center, size, [{ ...first, ...size }], 24, bounds)
    const third = nextNodePosition(
      center,
      size,
      [
        { ...first, ...size },
        { ...second, ...size },
      ],
      24,
      bounds,
    )

    expect(first).toEqual({ x: 340, y: 300 })
    expect(second).toEqual({ x: 684, y: 300 })
    expect(third).toEqual({ x: 340, y: 524 })
  })

  it('keeps new nodes from overlapping when the viewport has no free slot', () => {
    const size = { w: 320, h: 200 }
    const center = { x: 500, y: 400 }
    const bounds = { minX: 100, minY: 100, maxX: 1100, maxY: 800 }
    // 视口只容得下两行；两行都被占满后，旧实现会退回中心点并与已有节点重叠。
    const occupied = [0, 1].flatMap((row) =>
      [0, 1, -1, 2, -2].map((column) => ({
        x: 340 + column * 344,
        y: 300 + row * 224,
        ...size,
      })),
    )

    const position = nextNodePosition(center, size, occupied, 24, bounds)
    const overlapsAny = occupied.some(
      (node) =>
        position.x < node.x + node.w + 24 &&
        position.x + size.w + 24 > node.x &&
        position.y < node.y + node.h + 24 &&
        position.y + size.h + 24 > node.y,
    )
    expect(overlapsAny).toBe(false)
  })
})
