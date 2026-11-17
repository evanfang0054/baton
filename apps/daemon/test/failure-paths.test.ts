import { afterEach, describe, expect, it } from 'vitest'
import type { TestApp } from './helpers/app.js'
import { buildTestApp } from './helpers/app.js'
import { WsClient } from './helpers/ws-client.js'

const apps: TestApp[] = []
const clients: WsClient[] = []

async function setup(): Promise<{ app: TestApp; ws: WsClient }> {
  const app = await buildTestApp({ useSessionRunner: true, useVerifyRunner: true })
  apps.push(app)
  await app.app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.app.server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  const ws = new WsClient(`ws://127.0.0.1:${address.port}/ws`)
  clients.push(ws)
  await ws.open()
  return { app, ws }
}

function createPayload(app: TestApp, verifyCommand: string) {
  return {
    workspaceId: app.handle.seeded.workspaceId,
    nodeId: app.handle.seeded.nodeId,
    title: 'demo',
    prompt: '把登录页改成暗黑模式',
    contextNodeIds: ['text-1'],
    engine: 'fake',
    workspaceMode: 'main',
    verifyCommand,
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => 0)))
  const current = apps.splice(0)
  await Promise.all(current.map((app) => app.app.close()))
  await Promise.all(current.map((app) => app.handle.cleanup()))
})

describe('failure paths', () => {
  it('records a failed verify and re-enqueues after reject', async () => {
    const { app, ws } = await setup()
    ws.send({
      v: 1,
      type: 'task.create',
      id: 'c1',
      ts: 1,
      payload: createPayload(app, 'node -e "process.exit(3)"'),
    })
    const created = await ws.next('ack')
    const taskId = (created.payload as { data: { taskId: string } }).data.taskId
    ws.send({ v: 1, type: 'task.enqueue', id: 'c2', ts: 1, payload: { taskId } })
    await ws.next('ack')

    const approval = await ws.next('approval.request', 10_000)
    const approvalId = (approval.payload as { approvalId: string }).approvalId
    ws.send({
      v: 1,
      type: 'approval.decide',
      id: 'c3',
      ts: 1,
      payload: { approvalId, decision: 'allow' },
    })
    await ws.next('ack')

    const verify = await ws.next('verify.result', 10_000)
    const payload = verify.payload as { reviewId: string; exitCode: number }
    expect(payload.exitCode).toBe(3)

    ws.send({
      v: 1,
      type: 'review.decide',
      id: 'c4',
      ts: 1,
      payload: { reviewId: payload.reviewId, decision: 'reject', feedback: '请修复' },
    })
    await ws.next('ack')
    await waitFor(() => app.handle.runtime.getReviewByTask(taskId)?.verdict === 'rejected')
    expect(app.handle.runtime.getTask(taskId)?.prompt).toContain('<feedback>')
    expect(app.handle.runtime.getTask(taskId)?.prompt).toContain('请修复')

    app.handle.runtime.cancel(taskId)
    await waitFor(() => app.handle.runtime.getTask(taskId)?.status === 'cancelled')
  })

  it('cancels a task while verify is running', async () => {
    const { app, ws } = await setup()
    ws.send({
      v: 1,
      type: 'task.create',
      id: 'c1',
      ts: 1,
      payload: createPayload(app, 'node -e "setTimeout(() => {}, 60000)"'),
    })
    const created = await ws.next('ack')
    const taskId = (created.payload as { data: { taskId: string } }).data.taskId
    ws.send({ v: 1, type: 'task.enqueue', id: 'c2', ts: 1, payload: { taskId } })
    await ws.next('ack')

    const approval = await ws.next('approval.request', 10_000)
    const approvalId = (approval.payload as { approvalId: string }).approvalId
    ws.send({
      v: 1,
      type: 'approval.decide',
      id: 'c3',
      ts: 1,
      payload: { approvalId, decision: 'allow' },
    })
    await ws.next('ack')

    await waitFor(() => app.handle.runtime.getTask(taskId)?.status === 'verifying')
    ws.send({
      v: 1,
      type: 'task.cancel',
      id: 'c4',
      ts: 1,
      payload: { taskId, reason: 'user cancelled' },
    })
    await ws.next('ack')
    await waitFor(() => app.handle.runtime.getTask(taskId)?.status === 'cancelled')
  })
})
