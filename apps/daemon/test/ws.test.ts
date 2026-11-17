import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../src/app.js'

const apps: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

async function listen(token: string | null): Promise<string> {
  const app = await buildApp({
    host: '127.0.0.1',
    port: 0,
    token,
    dataDir: '/tmp',
    webRoot: '/tmp',
    workspacesRoot: '/tmp',
    maxConcurrency: 1,
  })
  apps.push(app)
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  return `ws://127.0.0.1:${address.port}/ws`
}

function nextMessage(ws: WebSocket): Promise<{ type: string }> {
  return new Promise((resolve, reject) => {
    ws.on('message', (data) => resolve(JSON.parse(String(data)) as { type: string }))
    ws.on('error', reject)
  })
}

describe('ws', () => {
  it('answers ping after auth', async () => {
    const url = await listen('secret')
    const ws = new WebSocket(`${url}?token=secret`)
    const pong = nextMessage(ws)
    ws.on('open', () => {
      ws.send(JSON.stringify({ v: 1, type: 'ping', id: 'p1', ts: 1, payload: { id: 'p1' } }))
    })
    await expect(pong).resolves.toMatchObject({ type: 'pong' })
    ws.close()
  })

  it('closes unauthenticated connections with 4401', async () => {
    const url = await listen('secret')
    const ws = new WebSocket(url)
    const code = await new Promise<number>((resolve) => ws.on('close', (c) => resolve(c)))
    expect(code).toBe(4401)
  }, 8000)

  it('allows local mode without a token', async () => {
    const url = await listen(null)
    const ws = new WebSocket(url)
    const pong = nextMessage(ws)
    ws.on('open', () => {
      ws.send(JSON.stringify({ v: 1, type: 'ping', id: 'p2', ts: 1, payload: { id: 'p2' } }))
    })
    await expect(pong).resolves.toMatchObject({ type: 'pong' })
    ws.close()
  })
})
