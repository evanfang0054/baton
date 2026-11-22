import { describe, expect, it } from 'vitest'
import { ClientMessage } from '../src/commands.js'

const fixtures = [
  ['resume', { sinceSeq: 10 }],
  [
    'task.create',
    {
      workspaceId: 'w1',
      nodeId: 'n1',
      title: 'demo',
      prompt: 'do it',
      contextNodeIds: ['n1'],
      engine: 'claude-sdk',
    },
  ],
  ['task.enqueue', { taskId: 't1' }],
  ['task.cancel', { taskId: 't1', reason: 'user' }],
  ['approval.decide', { approvalId: 'a1', decision: 'allow' }],
  ['review.decide', { reviewId: 'r1', decision: 'reject', feedback: 'fix it' }],
  [
    'node.create',
    {
      canvasId: 'c1',
      node: {
        type: 'text',
        x: 0,
        y: 0,
        w: 320,
        h: 200,
        groupId: null,
        data: { content: 'hello' },
      },
    },
  ],
  ['node.update', { nodeId: 'n1', patch: { x: 10, y: 20 } }],
  ['node.update', { nodeId: 'n1', patch: { groupId: 'g1' } }],
  ['node.delete', { nodeId: 'n1' }],
  [
    'node.move_many',
    {
      canvasId: 'c1',
      moves: [
        { nodeId: 'g1', x: 10, y: 20 },
        { nodeId: 'n1', x: 30, y: 40 },
      ],
    },
  ],
  [
    'group.create',
    {
      canvasId: 'c1',
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      label: '需求',
      childIds: ['n1', 'n2'],
    },
  ],
  [
    'node.create',
    {
      canvasId: 'c1',
      node: {
        type: 'image',
        x: 0,
        y: 0,
        w: 320,
        h: 200,
        groupId: null,
        data: { src: 'https://example.com/a.png' },
      },
    },
  ],
  [
    'node.create',
    {
      canvasId: 'c1',
      node: {
        type: 'file',
        x: 0,
        y: 0,
        w: 320,
        h: 200,
        groupId: null,
        data: { path: 'docs/spec.md', name: 'spec.md' },
      },
    },
  ],
  [
    'node.create',
    {
      canvasId: 'c1',
      node: {
        type: 'agent',
        x: 0,
        y: 0,
        w: 320,
        h: 200,
        groupId: null,
        data: { title: 'agent', engine: 'claude-sdk', taskId: null },
      },
    },
  ],
  [
    'node.create',
    {
      canvasId: 'c1',
      node: {
        type: 'review',
        x: 0,
        y: 0,
        w: 320,
        h: 200,
        groupId: null,
        data: { taskId: 't1' },
      },
    },
  ],
  [
    'node.create',
    {
      canvasId: 'c1',
      node: {
        type: 'group',
        x: 0,
        y: 0,
        w: 320,
        h: 200,
        groupId: null,
        data: { label: 'group', collapsed: false },
      },
    },
  ],
  ['edge.create', { sourceId: 'n1', targetId: 'n2' }],
  ['edge.create', { sourceId: 'n1', targetId: 'n2', type: 'context' }],
  ['edge.delete', { edgeId: 'e1' }],
  [
    'supervisor.send',
    {
      workspaceId: 'w1',
      requestId: 'r1',
      text: '给这个 Agent 建个任务',
      contextNodeIds: ['n1'],
      targetNodeId: 'a1',
    },
  ],
  ['supervisor.action.decide', { workspaceId: 'w1', actionId: 'a1', decision: 'apply' }],
  ['task.reauthorize', { taskId: 't1' }],
] as const

describe('ClientMessage', () => {
  it.each(fixtures)('parses %s', (type, payload) => {
    const parsed = ClientMessage.parse({ v: 1, id: 'c1', ts: 1, type, payload })
    expect(parsed.type).toBe(type)
  })

  it('defaults workspaceMode to main', () => {
    const parsed = ClientMessage.parse({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'task.create',
      payload: {
        workspaceId: 'w1',
        nodeId: 'n1',
        title: 'demo',
        prompt: 'do it',
        contextNodeIds: ['n1'],
        engine: 'claude-sdk',
      },
    })
    if (parsed.type !== 'task.create') throw new Error('expected task.create')
    expect(parsed.payload.workspaceMode).toBe('main')
  })

  it('requires feedback on reject and rejects it on approve', () => {
    expect(() =>
      ClientMessage.parse({
        v: 1,
        id: 'c1',
        ts: 1,
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'reject' },
      }),
    ).toThrow()
    expect(() =>
      ClientMessage.parse({
        v: 1,
        id: 'c1',
        ts: 1,
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'approve', feedback: 'not allowed' },
      }),
    ).toThrow()
  })

  it('accepts approve without feedback', () => {
    expect(
      ClientMessage.parse({
        v: 1,
        id: 'c1',
        ts: 1,
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'approve' },
      }).type,
    ).toBe('review.decide')
  })

  it('accepts unsupported node types at schema level for handler rejection', () => {
    const parsed = ClientMessage.parse({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'node.create',
      payload: {
        canvasId: 'c1',
        node: {
          type: 'image',
          x: 0,
          y: 0,
          w: 320,
          h: 200,
          groupId: null,
          data: { src: 'https://example.com/a.png' },
        },
      },
    })
    expect(parsed.type).toBe('node.create')
  })

  it('round-trips node.create payload', () => {
    const payload = {
      canvasId: 'c1',
      node: {
        type: 'text' as const,
        x: 1,
        y: 2,
        w: 320,
        h: 200,
        groupId: null,
        data: { content: 'hello' },
      },
    }
    expect(ClientMessage.parse({ v: 1, id: 'c1', ts: 1, type: 'node.create', payload })).toEqual({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'node.create',
      payload,
    })
  })

  it('accepts groupId in node.update patch', () => {
    const parsed = ClientMessage.parse({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'node.update',
      payload: { nodeId: 'n1', patch: { groupId: null } },
    })
    expect(parsed.type).toBe('node.update')
  })

  it('rejects empty node.move_many', () => {
    expect(() =>
      ClientMessage.parse({
        v: 1,
        id: 'c1',
        ts: 1,
        type: 'node.move_many',
        payload: { canvasId: 'c1', moves: [] },
      }),
    ).toThrow()
  })

  it('rejects group.create without children', () => {
    expect(() =>
      ClientMessage.parse({
        v: 1,
        id: 'c1',
        ts: 1,
        type: 'group.create',
        payload: { canvasId: 'c1', x: 0, y: 0, w: 100, h: 100, label: 'g', childIds: [] },
      }),
    ).toThrow()
  })

  it('rejects unknown node.update patch keys', () => {
    expect(() =>
      ClientMessage.parse({
        v: 1,
        id: 'c1',
        ts: 1,
        type: 'node.update',
        payload: { nodeId: 'n1', patch: { type: 'group' } },
      }),
    ).toThrow()
  })

  it('rejects unknown node types', () => {
    expect(() =>
      ClientMessage.parse({
        v: 1,
        id: 'c1',
        ts: 1,
        type: 'node.create',
        payload: {
          canvasId: 'c1',
          node: { type: 'video', x: 0, y: 0, w: 320, h: 200, groupId: null, data: {} },
        },
      }),
    ).toThrow()
  })

  it('rejects node.update without nodeId', () => {
    expect(() =>
      ClientMessage.parse({
        v: 1,
        id: 'c1',
        ts: 1,
        type: 'node.update',
        payload: { patch: { x: 1 } },
      }),
    ).toThrow()
  })

  it('rejects an unknown supervisor action decision', () => {
    expect(() =>
      ClientMessage.parse({
        v: 1,
        id: 'c1',
        ts: 1,
        type: 'supervisor.action.decide',
        payload: { workspaceId: 'w1', actionId: 'a1', decision: 'execute' },
      }),
    ).toThrow()
  })
})
