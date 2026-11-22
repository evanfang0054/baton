import { afterEach, describe, expect, it } from 'vitest'
import { FakeAdapter } from '@baton/adapters'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'
import type { TestApp } from './helpers/app.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'
import { waitFor } from './helpers/async.js'
import { createTaskPayload, createWsTestApp, type WsTestApp } from './helpers/ws.js'
import type { WsClient } from './helpers/ws-client.js'

const apps: TestApp[] = []
const clients: WsClient[] = []

async function setup(): Promise<WsTestApp> {
  const created = await createWsTestApp({ useSessionRunner: true, useVerifyRunner: true })
  apps.push(created)
  clients.push(created.ws)
  return created
}

function createPayload(handle: TestRuntimeHandle, verifyCommand: string) {
  return createTaskPayload(handle, { verifyCommand })
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => 0)))
  const current = apps.splice(0)
  await Promise.all(current.map((app) => app.app.close()))
  await Promise.all(current.map((app) => app.handle.cleanup()))
})

describe('failure paths', () => {
  it('records a failed verify and re-enqueues after reject', async () => {
    const { handle, ws } = await setup()
    ws.send({
      v: 1,
      type: 'task.create',
      id: 'c1',
      ts: 1,
      payload: createPayload(handle, 'node -e "process.exit(3)"'),
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
    await waitFor(() => handle.runtime.getReviewByTask(taskId)?.verdict === 'rejected', 10_000)
    expect(handle.runtime.getTask(taskId)?.prompt).toContain('<feedback>')
    expect(handle.runtime.getTask(taskId)?.prompt).toContain('请修复')

    handle.runtime.cancel(taskId)
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'cancelled', 10_000)
  })

  it('cancels a task while verify is running', async () => {
    const { handle, ws } = await setup()
    ws.send({
      v: 1,
      type: 'task.create',
      id: 'c1',
      ts: 1,
      payload: createPayload(handle, 'node -e "setTimeout(() => {}, 60000)"'),
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

    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'verifying', 10_000)
    ws.send({
      v: 1,
      type: 'task.cancel',
      id: 'c4',
      ts: 1,
      payload: { taskId, reason: 'user cancelled' },
    })
    await ws.next('ack')
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'cancelled', 10_000)
  })

  it('records a worker failure summary without transcript', async () => {
    const created = await createWsTestApp({
      useSessionRunner: true,
      useVerifyRunner: true,
      adapters: createAdapterFactory({
        fake: new FakeAdapter({ script: [{ kind: 'error', message: 'boom token=abc' }] }),
      }),
    })
    apps.push(created)
    clients.push(created.ws)
    const { handle, ws } = created
    ws.send({
      v: 1,
      type: 'task.create',
      id: 'f1',
      ts: 1,
      payload: createTaskPayload(handle, 'node -e "process.exit(0)"'),
    })
    const createdAck = await ws.next('ack')
    const taskId = (createdAck.payload as { data: { taskId: string } }).data.taskId
    ws.send({ v: 1, type: 'task.enqueue', id: 'f2', ts: 1, payload: { taskId } })
    await ws.next('ack')
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'failed', 10_000)
    const failure = handle.runtime.failures.latest(taskId)
    expect(failure?.stage).toBe('run')
    expect(failure?.lastError).not.toContain('abc')
  })
})
