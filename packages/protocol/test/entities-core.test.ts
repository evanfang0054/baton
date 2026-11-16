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
  it('parses workspace and canvas', () => {
    expect(Workspace.parse({ id: 'w1', name: 'demo', relPath: 'demo', createdAt: 1 }).relPath).toBe(
      'demo',
    )
    expect(
      Canvas.parse({ id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } }).id,
    ).toBe('c1')
  })

  it('parses six node types and rejects mismatched data', () => {
    const text = Node.parse({ ...nodeBase, type: 'text', data: { content: 'hi' } })
    expect(text.type).toBe('text')
    const group = Node.parse({ ...nodeBase, type: 'group', data: { label: 'G' } })
    expect(group.type === 'group' && group.data.collapsed).toBe(false)
    expect(() => Node.parse({ ...nodeBase, type: 'text', data: { src: 'x' } })).toThrow()
  })

  it('parses edge, task and session', () => {
    expect(
      Edge.parse({
        id: 'e1',
        canvasId: 'c1',
        sourceId: 'n1',
        targetId: 'n2',
        type: 'context',
      }),
    ).toBeTruthy()
    expect(
      Task.parse({
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
      }).status,
    ).toBe('todo')
    expect(
      Session.parse({
        id: 's1',
        taskId: 't1',
        adapter: 'fake',
        engineSessionId: null,
        status: 'running',
        startedAt: 1,
        endedAt: null,
      }).status,
    ).toBe('running')
  })
})
