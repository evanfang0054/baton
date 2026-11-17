import { describe, expect, it } from 'vitest'
import {
  CanvasQuery,
  CanvasResponse,
  TaskDetailResponse,
  TaskListQuery,
  TaskListResponse,
  WorkspaceCreateInput,
  WorkspaceCreateResponse,
  WorkspaceListResponse,
} from '../src/api.js'

const workspace = { id: 'w1', name: 'demo', relPath: 'demo', createdAt: 1 }
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

  it('validates canvas response with nodes and edges', () => {
    expect(CanvasQuery.parse({ workspaceId: 'w1' }).workspaceId).toBe('w1')
    expect(CanvasResponse.parse({ canvas, nodes: [], edges: [] }).canvas.id).toBe('c1')
  })

  it('validates task list query and response', () => {
    expect(TaskListQuery.parse({ workspaceId: 'w1', status: 'running' }).status).toBe('running')
    expect(() => TaskListQuery.parse({ workspaceId: 'w1', status: 'paused' })).toThrow()
    expect(TaskListResponse.parse({ tasks: [task] }).tasks).toHaveLength(1)
  })

  it('validates task detail with no review', () => {
    const detail = TaskDetailResponse.parse({
      task,
      sessions: [],
      approvals: [],
      review: null,
      waitingSince: null,
    })
    expect(detail.review).toBeNull()
  })
})
