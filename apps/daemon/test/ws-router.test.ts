import { afterEach, describe, expect, it } from 'vitest'
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

    ws.send({
      v: 1,
      type: 'node.update',
      id: 'n2',
      ts: 1,
      payload: { nodeId, patch: { x: 50, y: 60, data: { content: 'updated' } } },
    })
    await ws.next('ack')

    ws.send({ v: 1, type: 'node.delete', id: 'n3', ts: 1, payload: { nodeId } })
    await ws.next('ack')
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

  it('rejects unsupported node types in 6a', async () => {
    const { handle, ws } = await setup()
    ws.send({
      v: 1,
      type: 'node.create',
      id: 'n1',
      ts: 1,
      payload: {
        canvasId: handle.seeded.canvasId,
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
