import { afterEach, describe, expect, it } from 'vitest'
import type { TestApp } from './helpers/app.js'
import { buildTestApp } from './helpers/app.js'
import { WsClient } from './helpers/ws-client.js'

const apps: TestApp[] = []
const clients: WsClient[] = []

async function setup(): Promise<{ app: TestApp; ws: WsClient; url: string }> {
  const app = await buildTestApp()
  apps.push(app)
  await app.app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.app.server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  const url = `ws://127.0.0.1:${address.port}/ws`
  const ws = new WsClient(url)
  clients.push(ws)
  await ws.open()
  return { app, ws, url }
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => 0)))
  const current = apps.splice(0)
  await Promise.all(current.map((app) => app.app.close()))
  await Promise.all(current.map((app) => app.handle.cleanup()))
})

describe('resume replay', () => {
  it('replays missed task status events after reconnect', async () => {
    const first = await setup()
    first.ws.send({
      v: 1,
      type: 'task.create',
      id: 'c1',
      ts: 1,
      payload: {
        workspaceId: first.app.handle.seeded.workspaceId,
        nodeId: first.app.handle.seeded.nodeId,
        title: 'demo',
        prompt: 'demo',
        contextNodeIds: ['text-1'],
        engine: 'fake',
        workspaceMode: 'main',
      },
    })
    const created = await first.ws.next('ack')
    const taskId = (created.payload as { data: { taskId: string } }).data.taskId
    first.ws.send({ v: 1, type: 'task.enqueue', id: 'c2', ts: 1, payload: { taskId } })
    await first.ws.next('ack')
    await first.ws.close()
    clients.splice(clients.indexOf(first.ws), 1)

    const second = new WsClient(first.url)
    clients.push(second)
    await second.open()
    second.send({ v: 1, type: 'resume', id: 'r1', ts: 1, payload: { sinceSeq: 0 } })

    const replayed: Array<{ type: string; seq?: number }> = []
    let ack: Record<string, unknown> | undefined
    while (!ack) {
      const message = await second.next(undefined, 5000)
      if (message.type === 'ack') {
        ack = message
      } else {
        replayed.push(message as { type: string; seq?: number })
      }
    }

    expect(replayed.some((message) => message.type === 'task.status')).toBe(true)
    const cursor = (ack.payload as { data: { cursor: number } }).data.cursor
    const lastSeq = replayed.at(-1)?.seq ?? 0
    expect(cursor).toBeGreaterThanOrEqual(lastSeq)
  })
})
