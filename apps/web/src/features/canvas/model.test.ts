import type { Node as ProtocolNode, TaskSummary } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { mergeFlowNodes, nextNodePosition, toFlowEdges, toFlowNodes } from './model'

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
  retryCount: 0,
  createdAt: 1,
  updatedAt: 1,
  attention: 'none',
  waitingSince: null,
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

  it('falls back to the default node type for non-6a nodes', () => {
    const image: ProtocolNode = {
      ...textNode,
      id: 'n3',
      type: 'image',
      data: { src: 'https://example.com/a.png' },
    }
    expect(toFlowNodes([image], [])[0]?.type).toBe('default')
  })

  it('maps protocol edges to read-only flow edges', () => {
    const edges = toFlowEdges([
      { id: 'e1', canvasId: 'c1', sourceId: 'n1', targetId: 'n2', type: 'context' },
    ])
    expect(edges[0]).toMatchObject({
      id: 'e1',
      source: 'n1',
      target: 'n2',
      selectable: false,
      focusable: false,
      deletable: false,
    })
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
})
