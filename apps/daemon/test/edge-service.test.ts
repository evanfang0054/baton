import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createTestDb, seedTask, seedTextNode } from './helpers/db.js'
import { createEdge, deleteEdge } from '../src/runtime/edge-service.js'

function setup() {
  const database = createTestDb()
  const seeded = seedTask(database.raw)
  seedTextNode(database.raw, seeded.canvasId, 'text-1', '需求')
  return { database, seeded }
}

describe('edge service', () => {
  it('creates and deletes a context edge', () => {
    const { database, seeded } = setup()
    const deps = { db: database.db, newId: () => 'e1' }
    const created = createEdge(deps, {
      sourceId: 'text-1',
      targetId: seeded.nodeId,
      type: 'context',
    })
    expect(created).toEqual({ ok: true, edgeId: 'e1' })
    expect(deleteEdge(deps, { edgeId: 'e1' })).toEqual({ ok: true })
    expect(deleteEdge(deps, { edgeId: 'e1' })).toMatchObject({
      ok: false,
      error: { code: 'edge_not_found' },
    })
  })

  it('rejects self loops and duplicates but allows the reverse direction', () => {
    const { database, seeded } = setup()
    let id = 0
    const deps = { db: database.db, newId: () => `e${++id}` }

    expect(
      createEdge(deps, { sourceId: 'text-1', targetId: 'text-1', type: 'context' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'edge_self_loop' },
    })
    expect(
      createEdge(deps, { sourceId: 'text-1', targetId: seeded.nodeId, type: 'context' }).ok,
    ).toBe(true)
    expect(
      createEdge(deps, { sourceId: 'text-1', targetId: seeded.nodeId, type: 'context' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'edge_duplicate' },
    })
    expect(
      createEdge(deps, { sourceId: seeded.nodeId, targetId: 'text-1', type: 'context' }).ok,
    ).toBe(true)
  })

  it('rejects missing endpoints and cross-canvas edges', () => {
    const { database, seeded } = setup()
    const deps = { db: database.db, newId: () => randomUUID() }

    expect(
      createEdge(deps, { sourceId: 'text-1', targetId: 'missing', type: 'context' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'node_not_found' },
    })

    const otherWorkspaceId = randomUUID()
    const otherCanvasId = randomUUID()
    const otherNodeId = randomUUID()
    database.raw
      .prepare('insert into workspace (id, name, rel_path, created_at) values (?, ?, ?, ?)')
      .run(otherWorkspaceId, 'other', `other-${otherWorkspaceId}`, 1)
    database.raw
      .prepare('insert into canvas (id, workspace_id, viewport_json) values (?, ?, ?)')
      .run(otherCanvasId, otherWorkspaceId, '{"x":0,"y":0,"zoom":1}')
    database.raw
      .prepare(
        `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
         values (?, ?, 'text', 0, 0, 320, 200, null, ?, 1, 1)`,
      )
      .run(otherNodeId, otherCanvasId, JSON.stringify({ content: 'other' }))

    expect(
      createEdge(deps, { sourceId: 'text-1', targetId: otherNodeId, type: 'context' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'edge_cross_canvas' },
    })
    expect(seeded.canvasId).not.toBe(otherCanvasId)
  })
})
