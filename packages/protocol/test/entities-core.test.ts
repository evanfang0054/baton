import { describe, expect, it } from 'vitest'
import { Canvas } from '../src/entities/canvas.js'
import { Edge } from '../src/entities/edge.js'
import { Node } from '../src/entities/node.js'
import { Session } from '../src/entities/session.js'
import { Task } from '../src/entities/task.js'
import { Workspace } from '../src/entities/workspace.js'

const nodeBase = {
  id: 'n1',
  canvasId: 'c1',
  x: 0,
  y: 0,
  groupId: null,
  createdAt: 1,
  updatedAt: 1,
}

describe('core entities', () => {
  it('parses Workspace and rejects an empty name', () => {
    expect(Workspace.parse({ id: 'w1', name: 'demo', relPath: 'demo', createdAt: 1 })).toEqual({
      id: 'w1',
      name: 'demo',
      relPath: 'demo',
      createdAt: 1,
    })
    expect(() => Workspace.parse({ id: 'w1', name: '', relPath: 'demo', createdAt: 1 })).toThrow()
  })

  it('parses Canvas and rejects a non-positive zoom', () => {
    expect(
      Canvas.parse({ id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } }),
    ).toEqual({ id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } })
    expect(() =>
      Canvas.parse({ id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 0 } }),
    ).toThrow()
  })

  it.each([
    ['text', { content: 'hi' }],
    ['image', { src: 'artifacts/n1.png', alt: '设计稿' }],
    ['file', { path: 'src/a.ts', name: 'a.ts', mime: 'text/plain' }],
    ['agent', { title: 'Claude', engine: 'fake', taskId: null }],
    ['review', { taskId: 't1' }],
    ['group', { label: 'Group A' }],
  ] as const)('parses the %s node variant', (type, data) => {
    const parsed = Node.parse({ ...nodeBase, type, data })
    expect(parsed.type).toBe(type)
    expect(parsed.data).toMatchObject(data)
    if (parsed.type === 'group') expect(parsed.data.collapsed).toBe(false)
  })

  it.each([
    ['text', { src: 'x' }],
    ['image', { content: 'x' }],
    ['file', { path: 'src/a.ts' }],
    ['agent', { title: 'Claude', engine: 'unknown', taskId: null }],
    ['review', {}],
    ['group', { label: '' }],
  ] as const)('rejects mismatched %s node data', (type, data) => {
    expect(() => Node.parse({ ...nodeBase, type, data })).toThrow()
  })

  it('parses Edge and rejects a non-context type', () => {
    expect(
      Edge.parse({
        id: 'e1',
        canvasId: 'c1',
        sourceId: 'n1',
        targetId: 'n2',
        type: 'context',
      }),
    ).toEqual({
      id: 'e1',
      canvasId: 'c1',
      sourceId: 'n1',
      targetId: 'n2',
      type: 'context',
    })
    expect(() =>
      Edge.parse({
        id: 'e1',
        canvasId: 'c1',
        sourceId: 'n1',
        targetId: 'n2',
        type: 'flow',
      }),
    ).toThrow()
  })

  it('parses Task and rejects a negative retryCount', () => {
    const task = {
      id: 't1',
      workspaceId: 'w1',
      nodeId: 'n1',
      title: 't',
      prompt: 'p',
      status: 'todo',
      engine: 'fake',
      workspaceMode: 'main',
      branch: null,
      worktreePath: null,
      verifyCommand: null,
      retryCount: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    expect(Task.parse(task)).toEqual(task)
    expect(() => Task.parse({ ...task, retryCount: -1 })).toThrow()
  })

  it('parses Session and requires an explicit endedAt field', () => {
    const session = {
      id: 's1',
      taskId: 't1',
      adapter: 'fake',
      engineSessionId: null,
      status: 'running',
      startedAt: 1,
      endedAt: null,
    }
    expect(Session.parse(session)).toEqual(session)
    const missingEndedAt = { ...session }
    delete (missingEndedAt as { endedAt?: unknown }).endedAt
    expect(() => Session.parse(missingEndedAt)).toThrow()
  })
})
