import { describe, expect, it } from 'vitest'
import {
  CanvasQuery,
  CanvasResponse,
  SessionEventsQuery,
  SessionEventsResponse,
  TaskDetailResponse,
  TaskListQuery,
  TaskListResponse,
  TaskSummary,
  WorkspaceCreateInput,
  WorkspaceCreateResponse,
  WorkspaceListResponse,
  WorkspaceTrustInput,
  WorkspaceTrustResponse,
} from '../src/api.js'

const workspace = {
  id: 'w1',
  name: 'demo',
  relPath: 'demo',
  trusted: false,
  projectHooks: 'off',
  trustedAt: null,
  createdAt: 1,
}
const canvas = { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } }
const task = {
  id: 't1',
  workspaceId: 'w1',
  nodeId: null,
  title: 'demo',
  prompt: '<task>demo</task>',
  status: 'todo',
  waitingReason: null,
  engine: 'fake',
  workspaceMode: 'main',
  branch: null,
  worktreePath: null,
  verifyCommand: null,
  retryCount: 0,
  createdAt: 1,
  updatedAt: 1,
  attention: 'none',
  waitingSince: null,
}

describe('REST DTO schemas', () => {
  it('validates workspace create input', () => {
    expect(WorkspaceCreateInput.parse({ name: 'demo', relPath: 'demo' })).toEqual({
      name: 'demo',
      relPath: 'demo',
    })
    expect(() => WorkspaceCreateInput.parse({ name: '', relPath: 'demo' })).toThrow()
  })

  it('validates workspace responses', () => {
    expect(WorkspaceListResponse.parse({ workspaces: [workspace] }).workspaces).toHaveLength(1)
    expect(WorkspaceCreateResponse.parse({ workspace, canvas }).workspace.id).toBe('w1')
  })

  it('validates workspace trust input and response', () => {
    expect(WorkspaceTrustInput.parse({ trusted: true, projectHooks: 'on' })).toEqual({
      trusted: true,
      projectHooks: 'on',
    })
    expect(WorkspaceTrustInput.parse({ trusted: false })).toEqual({ trusted: false })
    expect(() => WorkspaceTrustInput.parse({ trusted: 'yes' })).toThrow()
    expect(WorkspaceTrustResponse.parse({ workspace }).workspace.trusted).toBe(false)
  })

  it('validates canvas response with nodes and edges', () => {
    expect(CanvasQuery.parse({ workspaceId: 'w1' }).workspaceId).toBe('w1')
    expect(CanvasResponse.parse({ canvas, nodes: [], edges: [] }).canvas.id).toBe('c1')
  })

  it('validates task list query and response', () => {
    expect(TaskListQuery.parse({ workspaceId: 'w1', status: 'running' }).status).toBe('running')
    expect(() => TaskListQuery.parse({ workspaceId: 'w1', status: 'paused' })).toThrow()
    expect(TaskListResponse.parse({ tasks: [task] }).tasks).toHaveLength(1)
  })

  it('validates task summary attention and waitingSince', () => {
    expect(TaskSummary.parse(task)).toEqual(task)
    expect(TaskListResponse.parse({ tasks: [task] })).toEqual({ tasks: [task] })
    expect(
      TaskSummary.parse({ ...task, status: 'waiting_input', waitingSince: 42 }).waitingSince,
    ).toBe(42)
    expect(() => TaskListResponse.parse({ tasks: [{ ...task, attention: 'paused' }] })).toThrow()
  })

  it.each(['none', 'needs_approval', 'needs_reply', 'needs_review'] as const)(
    'accepts attention %s',
    (attention) => {
      expect(TaskSummary.parse({ ...task, attention }).attention).toBe(attention)
    },
  )

  it('validates session events query and response', () => {
    expect(SessionEventsQuery.parse({}).sinceSeq).toBe(0)
    expect(SessionEventsQuery.parse({ sinceSeq: '2', limit: '10' })).toMatchObject({
      sinceSeq: 2,
      limit: 10,
    })
    expect(SessionEventsQuery.parse({ sinceSeq: '0', limit: '1' }).limit).toBe(1)
    expect(SessionEventsQuery.parse({ sinceSeq: '0', limit: '1000' }).limit).toBe(1000)
    expect(() => SessionEventsQuery.parse({ sinceSeq: -1 })).toThrow()
    expect(() => SessionEventsQuery.parse({ limit: 0 })).toThrow()
    expect(() => SessionEventsQuery.parse({ limit: 1001 })).toThrow()

    const response = {
      sessionId: 's1',
      events: [{ seq: 1, type: 'RUN_STARTED', payload: {}, ts: 1 }],
      nextSeq: 1,
      hasMore: false,
    }
    expect(SessionEventsResponse.parse(response)).toEqual(response)
  })

  it('validates task detail with no review', () => {
    const detail = TaskDetailResponse.parse({
      task,
      sessions: [],
      approvals: [],
      review: null,
      waitingSince: null,
      attention: 'none',
    })
    expect(detail.review).toBeNull()
  })
})
