import { afterEach, describe, expect, it } from 'vitest'
import { getNode } from '../src/db/repositories.js'
import type { TestApp } from './helpers/app.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'
import { createTaskPayload, createWsTestApp, type WsTestApp } from './helpers/ws.js'
import type { WsClient } from './helpers/ws-client.js'

const apps: TestApp[] = []
const clients: WsClient[] = []

async function setup(): Promise<WsTestApp> {
  const created = await createWsTestApp()
  apps.push(created)
  clients.push(created.ws)
  return created
}

function taskPayload(handle: TestRuntimeHandle) {
  return createTaskPayload(handle)
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => 0)))
  const current = apps.splice(0)
  await Promise.all(current.map((app) => app.app.close()))
  await Promise.all(current.map((app) => app.handle.cleanup()))
})

describe('ws router', () => {
  it('acks task.create and task.enqueue with data', async () => {
    const { handle, ws } = await setup()
    ws.send({
      v: 1,
      type: 'task.create',
      id: 'c1',
      ts: 1,
      payload: taskPayload(handle),
    })
    const created = await ws.next('ack')
    expect(created.payload).toMatchObject({ commandId: 'c1', ok: true })
    const taskId = (created.payload as { data: { taskId: string } }).data.taskId
    expect(taskId).toBeTruthy()

    ws.send({
      v: 1,
      type: 'task.enqueue',
      id: 'c2',
      ts: 1,
      payload: { taskId },
    })
    const enqueued = await ws.next('ack')
    expect((enqueued.payload as { data: { taskId: string } }).data.taskId).toBe(taskId)
  })

  it('replays events for resume and returns a cursor', async () => {
    const { handle, ws } = await setup()
    ws.send({
      v: 1,
      type: 'task.create',
      id: 'c1',
      ts: 1,
      payload: taskPayload(handle),
    })
    await ws.next('ack')

    ws.send({ v: 1, type: 'resume', id: 'r1', ts: 1, payload: { sinceSeq: 0 } })
    const ack = await ws.next('ack')
    expect((ack.payload as { data: { cursor: number } }).data.cursor).toBeGreaterThanOrEqual(0)
  })

  it('returns an error for an unknown command and keeps the connection open', async () => {
    const { ws } = await setup()
    ws.send({ v: 1, type: 'nope', id: 'c1', ts: 1, payload: {} })
    const error = await ws.next('error')
    expect(error.payload).toMatchObject({ commandId: 'c1', code: 'invalid_payload' })

    ws.send({ v: 1, type: 'ping', id: 'p1', ts: 1, payload: { id: 'p1' } })
    const pong = await ws.next('pong')
    expect(pong.type).toBe('pong')
  })

  it('routes session.reply and rejects a task that is not waiting', async () => {
    const { handle, ws } = await setup()
    ws.send({
      v: 1,
      type: 'task.create',
      id: 'c1',
      ts: 1,
      payload: taskPayload(handle),
    })
    const created = await ws.next('ack')
    const taskId = (created.payload as { data: { taskId: string } }).data.taskId

    ws.send({
      v: 1,
      type: 'session.reply',
      id: 'c2',
      ts: 1,
      payload: { taskId, text: 'hello' },
    })
    const error = await ws.next('error')
    expect(error.payload).toMatchObject({ commandId: 'c2', code: 'reply_not_allowed' })
  })

  it('creates, updates and deletes text nodes', async () => {
    const { handle, ws } = await setup()

    ws.send({
      v: 1,
      type: 'node.create',
      id: 'n1',
      ts: 1,
      payload: {
        canvasId: handle.seeded.canvasId,
        node: {
          type: 'text',
          x: 1,
          y: 2,
          w: 320,
          h: 200,
          groupId: null,
          data: { content: 'hello' },
        },
      },
    })
    const created = await ws.next('ack')
    const nodeId = (created.payload as { data: { nodeId: string } }).data.nodeId
    expect(nodeId).toBeTruthy()
    expect(getNode(handle.database.db, nodeId)?.type).toBe('text')

    ws.send({
      v: 1,
      type: 'node.update',
      id: 'n2',
      ts: 1,
      payload: { nodeId, patch: { x: 50, y: 60, data: { content: 'updated' } } },
    })
    await ws.next('ack')
    expect(getNode(handle.database.db, nodeId)).toMatchObject({
      x: 50,
      y: 60,
      data: { content: 'updated' },
    })

    ws.send({ v: 1, type: 'node.delete', id: 'n3', ts: 1, payload: { nodeId } })
    await ws.next('ack')
    expect(getNode(handle.database.db, nodeId)).toBeNull()
  })

  it('persists groupId on node.update and rejects invalid groups', async () => {
    const { handle, ws } = await setup()
    handle.database.raw
      .prepare(
        `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
         values ('m6-group-1', ?, 'group', 0, 0, 400, 300, null, ?, 1, 1)`,
      )
      .run(handle.seeded.canvasId, JSON.stringify({ label: 'g', collapsed: false }))
    handle.database.raw
      .prepare(
        `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
         values ('m6-text-1', ?, 'text', 10, 10, 100, 50, null, ?, 1, 1)`,
      )
      .run(handle.seeded.canvasId, JSON.stringify({ content: 'x' }))

    ws.send({
      v: 1,
      type: 'node.update',
      id: 'g1',
      ts: 1,
      payload: { nodeId: 'm6-text-1', patch: { groupId: 'm6-group-1' } },
    })
    await ws.next('ack')
    expect(getNode(handle.database.db, 'm6-text-1')?.groupId).toBe('m6-group-1')

    ws.send({
      v: 1,
      type: 'node.update',
      id: 'g2',
      ts: 1,
      payload: { nodeId: 'm6-text-1', patch: { groupId: 'missing' } },
    })
    const error = await ws.next('error')
    expect(error.payload).toMatchObject({ commandId: 'g2', code: 'group_invalid' })

    ws.send({
      v: 1,
      type: 'node.create',
      id: 'g3',
      ts: 1,
      payload: {
        canvasId: handle.seeded.canvasId,
        node: {
          type: 'text',
          x: 0,
          y: 0,
          w: 100,
          h: 50,
          groupId: 'missing',
          data: { content: 'x' },
        },
      },
    })
    expect((await ws.next('error')).payload).toMatchObject({
      commandId: 'g3',
      code: 'group_invalid',
    })
  })

  it('creates image nodes and rejects unsafe src', async () => {
    const { handle, ws } = await setup()
    ws.send({
      v: 1,
      type: 'node.create',
      id: 'i1',
      ts: 1,
      payload: {
        canvasId: handle.seeded.canvasId,
        node: {
          type: 'image',
          x: 0,
          y: 0,
          w: 320,
          h: 240,
          groupId: null,
          data: { src: '.baton/uploads/a.png', alt: 'a' },
        },
      },
    })
    const created = await ws.next('ack')
    const imageId = (created.payload as { data: { nodeId: string } }).data.nodeId
    expect(getNode(handle.database.db, imageId)?.type).toBe('image')

    ws.send({
      v: 1,
      type: 'node.create',
      id: 'i2',
      ts: 1,
      payload: {
        canvasId: handle.seeded.canvasId,
        node: {
          type: 'image',
          x: 0,
          y: 0,
          w: 320,
          h: 240,
          groupId: null,
          data: { src: 'javascript:alert(1)' },
        },
      },
    })
    expect((await ws.next('error')).payload).toMatchObject({
      commandId: 'i2',
      code: 'image_src_invalid',
    })

    ws.send({
      v: 1,
      type: 'node.create',
      id: 'i3',
      ts: 1,
      payload: {
        canvasId: handle.seeded.canvasId,
        node: {
          type: 'image',
          x: 0,
          y: 0,
          w: 320,
          h: 240,
          groupId: null,
          data: { src: '.baton/uploads/notes.txt' },
        },
      },
    })
    expect((await ws.next('error')).payload).toMatchObject({
      commandId: 'i3',
      code: 'image_src_invalid',
    })

    ws.send({
      v: 1,
      type: 'node.update',
      id: 'i4',
      ts: 1,
      payload: {
        nodeId: imageId,
        patch: { data: { src: 'file:///tmp/a.png' } },
      },
    })
    expect((await ws.next('error')).payload).toMatchObject({
      commandId: 'i4',
      code: 'image_src_invalid',
    })
  })

  it('creates a group, moves it with children, and ungroups on delete', async () => {
    const { handle, ws } = await setup()
    handle.database.raw
      .prepare(
        `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
         values ('m6-g-text-1', ?, 'text', 10, 10, 100, 50, null, ?, 1, 1)`,
      )
      .run(handle.seeded.canvasId, JSON.stringify({ content: 'a' }))
    handle.database.raw
      .prepare(
        `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
         values ('m6-g-text-2', ?, 'text', 20, 20, 100, 50, null, ?, 1, 1)`,
      )
      .run(handle.seeded.canvasId, JSON.stringify({ content: 'b' }))

    ws.send({
      v: 1,
      type: 'group.create',
      id: 'g1',
      ts: 1,
      payload: {
        canvasId: handle.seeded.canvasId,
        x: 0,
        y: 0,
        w: 400,
        h: 300,
        label: '组',
        childIds: ['m6-g-text-1', 'm6-g-text-2'],
      },
    })
    const grouped = await ws.next('ack')
    const groupId = (grouped.payload as { data: { groupId: string } }).data.groupId
    expect(getNode(handle.database.db, 'm6-g-text-1')?.groupId).toBe(groupId)

    ws.send({
      v: 1,
      type: 'node.move_many',
      id: 'm1',
      ts: 1,
      payload: {
        canvasId: handle.seeded.canvasId,
        moves: [
          { nodeId: groupId, x: 100, y: 100 },
          { nodeId: 'm6-g-text-1', x: 110, y: 110 },
        ],
      },
    })
    await ws.next('ack')
    expect(getNode(handle.database.db, groupId)).toMatchObject({ x: 100, y: 100 })
    expect(getNode(handle.database.db, 'm6-g-text-1')).toMatchObject({ x: 110, y: 110 })

    ws.send({
      v: 1,
      type: 'node.move_many',
      id: 'm2',
      ts: 1,
      payload: {
        canvasId: handle.seeded.canvasId,
        moves: [{ nodeId: 'missing', x: 0, y: 0 }],
      },
    })
    expect((await ws.next('error')).payload).toMatchObject({
      commandId: 'm2',
      code: 'node_move_invalid',
    })

    ws.send({
      v: 1,
      type: 'node.delete',
      id: 'd1',
      ts: 1,
      payload: { nodeId: groupId },
    })
    await ws.next('ack')
    expect(getNode(handle.database.db, groupId)).toBeNull()
    expect(getNode(handle.database.db, 'm6-g-text-1')?.groupId).toBeNull()
    expect(getNode(handle.database.db, 'm6-g-text-2')?.groupId).toBeNull()
  })

  it('renames an agent node without losing engine or taskId', async () => {
    const { handle, ws } = await setup()
    ws.send({
      v: 1,
      type: 'node.create',
      id: 'n1',
      ts: 1,
      payload: {
        canvasId: handle.seeded.canvasId,
        node: {
          type: 'agent',
          x: 0,
          y: 0,
          w: 320,
          h: 200,
          groupId: null,
          data: { title: 'old', engine: 'fake', taskId: null },
        },
      },
    })
    const created = await ws.next('ack')
    const nodeId = (created.payload as { data: { nodeId: string } }).data.nodeId

    ws.send({
      v: 1,
      type: 'node.update',
      id: 'n2',
      ts: 1,
      payload: { nodeId, patch: { data: { title: 'new' } } },
    })
    await ws.next('ack')
    expect(getNode(handle.database.db, nodeId)?.data).toEqual({
      title: 'new',
      engine: 'fake',
      taskId: null,
    })
  })

  it('deletes a node together with its edges', async () => {
    const { handle, ws } = await setup()
    handle.database.raw
      .prepare(
        `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
         values ('edge-target', ?, 'text', 0, 0, 320, 200, null, ?, 1, 1)`,
      )
      .run(handle.seeded.canvasId, JSON.stringify({ content: 'target' }))
    handle.database.raw
      .prepare(
        `insert into edge (id, canvas_id, source_id, target_id, type)
         values ('edge-1', ?, ?, 'edge-target', 'context')`,
      )
      .run(handle.seeded.canvasId, handle.seeded.nodeId)

    ws.send({
      v: 1,
      type: 'node.delete',
      id: 'n1',
      ts: 1,
      payload: { nodeId: 'edge-target' },
    })
    await ws.next('ack')

    expect(getNode(handle.database.db, 'edge-target')).toBeNull()
    expect(
      handle.database.raw
        .prepare('select count(*) as count from edge where source_id = ? or target_id = ?')
        .get('edge-target', 'edge-target'),
    ).toEqual({ count: 0 })
  })

  it('rejects deleting a node referenced by a task', async () => {
    const { handle, ws } = await setup()
    ws.send({
      v: 1,
      type: 'node.delete',
      id: 'n1',
      ts: 1,
      payload: { nodeId: handle.seeded.nodeId },
    })
    const error = await ws.next('error')
    expect(error.payload).toMatchObject({ code: 'node_in_use' })
  })

  it('rejects group/review via node.create', async () => {
    const { handle, ws } = await setup()
    ws.send({
      v: 1,
      type: 'node.create',
      id: 'n1',
      ts: 1,
      payload: {
        canvasId: handle.seeded.canvasId,
        node: {
          type: 'group',
          x: 0,
          y: 0,
          w: 320,
          h: 200,
          groupId: null,
          data: { label: 'g', collapsed: false },
        },
      },
    })
    const error = await ws.next('error')
    expect(error.payload).toMatchObject({ code: 'unsupported_node_type' })
  })

  it('rejects file node data updates', async () => {
    const { handle, ws } = await setup()
    ws.send({
      v: 1,
      type: 'node.create',
      id: 'n1',
      ts: 1,
      payload: {
        canvasId: handle.seeded.canvasId,
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
    })
    const created = await ws.next('ack')
    const nodeId = (created.payload as { data: { nodeId: string } }).data.nodeId

    ws.send({
      v: 1,
      type: 'node.update',
      id: 'n2',
      ts: 1,
      payload: { nodeId, patch: { data: { path: 'other.md' } } },
    })
    const error = await ws.next('error')
    expect(error.payload).toMatchObject({ code: 'invalid_payload' })
  })

  it('closes malformed envelopes with 4400', async () => {
    const { ws } = await setup()
    ws.sendRaw('{')
    expect(await ws.close()).toBe(4400)
  })
})
