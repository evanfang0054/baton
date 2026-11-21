import { describe, expect, it } from 'vitest'
import type { Edge, Node, TaskDetail } from '@baton/protocol'
import { buildTaskScene, relatedNodeIdSet, reviewCardPosition } from '../src/canvas/scene.js'

const agent = {
  id: 'a1',
  canvasId: 'c1',
  type: 'agent',
  x: 100,
  y: 100,
  w: 320,
  h: 200,
  groupId: null,
  createdAt: 1,
  updatedAt: 1,
  data: { title: 'Agent', engine: 'fake', taskId: 't1' },
} satisfies Node

const text = {
  id: 'n1',
  canvasId: 'c1',
  type: 'text',
  x: 0,
  y: 0,
  w: 320,
  h: 200,
  groupId: 'g1',
  createdAt: 1,
  updatedAt: 1,
  data: { content: '需求' },
} satisfies Node

const group = {
  id: 'g1',
  canvasId: 'c1',
  type: 'group',
  x: -20,
  y: -20,
  w: 400,
  h: 300,
  groupId: null,
  createdAt: 1,
  updatedAt: 1,
  data: { label: '需求区', collapsed: true },
} satisfies Node

const edge = {
  id: 'e1',
  canvasId: 'c1',
  sourceId: 'n1',
  targetId: 'a1',
  type: 'context',
} satisfies Edge

const task = {
  id: 't1',
  workspaceId: 'w1',
  nodeId: 'a1',
  title: '任务',
  prompt: '',
  status: 'review',
  waitingReason: null,
  engine: 'fake',
  workspaceMode: 'main',
  branch: null,
  worktreePath: null,
  verifyCommand: null,
  retryCount: 0,
  dangerouslySkipPermissions: false,
  budgetUsd: null,
  enqueuedAt: null,
  createdAt: 1,
  updatedAt: 1,
  context: {
    included: [{ id: 'n1', type: 'text', title: '需求', depth: 0, chars: 2 }],
    dropped: [],
    truncated: false,
    redactedPaths: [],
    relations: [],
    relationsTruncated: false,
    injections: [],
  },
  origin: {
    source: 'supervisor-chat',
    triggerId: 'tr1',
    threadId: 'th1',
    actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
    workspaceId: 'w1',
    targetNodeId: 'a1',
    contextNodeIds: ['n1'],
    policyVersion: 'p',
    promptVersion: 'v',
    createdAt: 1,
  },
} satisfies TaskDetail

describe('buildTaskScene', () => {
  it('collects target, context, origin, group expansion, edges and review card', () => {
    const scene = buildTaskScene(task, [agent, text, group], [edge])
    expect(scene.relatedNodeIds.sort()).toEqual(['a1', 'n1'])
    expect(scene.relatedGroupIds).toEqual(['g1'])
    expect(scene.relatedEdgeIds).toEqual(['e1'])
    expect(scene.expandGroupIds).toEqual(['g1'])
    expect(scene.missingNodeIds).toEqual([])
    expect(scene.showReviewCard).toBe(true)
    expect(scene.reviewCardPosition).toEqual({ x: 460, y: 100 })
  })

  it('reports missing nodes and falls back review position', () => {
    const scene = buildTaskScene(task, [text, group], [edge])
    expect(scene.relatedNodeIds).toEqual(['n1'])
    expect(scene.missingNodeIds).toEqual(['a1'])
    expect(scene.reviewCardPosition).toEqual({ x: 0, y: 0 })
  })

  it('drops edges with one endpoint outside the scene', () => {
    const other = {
      id: 'n2',
      canvasId: 'c1',
      type: 'text',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      groupId: null,
      createdAt: 1,
      updatedAt: 1,
      data: { content: 'other' },
    } satisfies Node
    const outside = { ...edge, id: 'e2', sourceId: 'n2' } satisfies Edge
    const scene = buildTaskScene(task, [agent, text, group, other], [edge, outside])
    expect(scene.relatedEdgeIds).toEqual(['e1'])
  })

  it('handles tasks without target, context or origin', () => {
    const scene = buildTaskScene({ ...task, nodeId: null, context: null, origin: null }, [], [])
    expect(scene.relatedNodeIds).toEqual([])
    expect(scene.missingNodeIds).toEqual([])
    expect(scene.expandGroupIds).toEqual([])
    expect(scene.reviewCardPosition).toEqual({ x: 0, y: 0 })
  })

  it('does not expand an open group', () => {
    const openGroup = { ...group, data: { ...group.data, collapsed: false } } satisfies Node
    const scene = buildTaskScene(task, [agent, text, openGroup], [edge])
    expect(scene.expandGroupIds).toEqual([])
    expect(scene.relatedGroupIds).toEqual(['g1'])
  })

  it('exposes the related-id set and review position helpers', () => {
    expect([...relatedNodeIdSet(task)].sort()).toEqual(['a1', 'n1'])
    expect(reviewCardPosition(task, [agent])).toEqual({ x: 460, y: 100 })
    const nonAgent = { ...agent, type: 'text', data: { content: 'x' } } satisfies Node
    expect(reviewCardPosition(task, [nonAgent])).toEqual({ x: 0, y: 0 })
  })

  it('does not include a group that no longer exists', () => {
    const scene = buildTaskScene(task, [agent, text], [edge])
    expect(scene.relatedGroupIds).toEqual([])
  })

  it('includes injection node ids and reports missing ones', () => {
    const injected = {
      ...task,
      context: {
        ...task.context,
        injections: [
          {
            seq: 1,
            at: 1,
            source: 'user' as const,
            note: null,
            nodeIds: ['n2', 'gone'],
            included: [],
            dropped: [],
            truncated: false,
            relations: [],
            relationsTruncated: false,
            chars: 1,
          },
        ],
      },
    } satisfies TaskDetail
    const scene = buildTaskScene(injected, [{ ...text, id: 'n2' }], [])
    expect(scene.relatedNodeIds).toContain('n2')
    expect(scene.missingNodeIds).toContain('gone')
  })
})
