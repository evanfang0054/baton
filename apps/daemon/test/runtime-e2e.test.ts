import { afterEach, describe, expect, it } from 'vitest'
import { FakeAdapter } from '@baton/adapters'
import type { TestApp } from './helpers/app.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'
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

async function nextStatus(
  ws: WsClient,
  taskId: string,
  status: string,
): Promise<Record<string, unknown>> {
  while (true) {
    const message = await ws.next('task.status', 10_000)
    const payload = message.payload as { taskId: string; status: string }
    if (payload.taskId === taskId && payload.status === status) {
      return payload as unknown as Record<string, unknown>
    }
  }
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => 0)))
  const current = apps.splice(0)
  await Promise.all(current.map((app) => app.app.close()))
  await Promise.all(current.map((app) => app.handle.cleanup()))
})

describe('M1-5 runtime e2e', () => {
  it('runs create → approval → verify → review → done over WS', async () => {
    const { handle, ws } = await setup()
    ws.send({
      v: 1,
      type: 'task.create',
      id: 'c1',
      ts: 1,
      payload: createPayload(handle, 'node -e "process.exit(0)"'),
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
    const verifyPayload = verify.payload as { reviewId: string; exitCode: number }
    expect(verifyPayload.exitCode).toBe(0)
    ws.send({
      v: 1,
      type: 'review.decide',
      id: 'c4',
      ts: 1,
      payload: { reviewId: verifyPayload.reviewId, decision: 'approve' },
    })
    await ws.next('ack')

    await nextStatus(ws, taskId, 'done')
    expect(handle.runtime.getTask(taskId)?.status).toBe('done')
    expect(handle.runtime.getReviewByTask(taskId)?.verdict).toBe('approved')
  })

  it('runs question → reply → verify → review → done over WS', async () => {
    const created = await createWsTestApp({
      useSessionRunner: true,
      useVerifyRunner: true,
      adapters: createAdapterFactory({
        fake: new FakeAdapter({
          script: [
            { kind: 'text', text: 'need a decision' },
            { kind: 'pause', outcome: 'blocked' },
            { kind: 'finish' },
          ],
        }),
      }),
    })
    apps.push(created)
    clients.push(created.ws)
    const { handle, ws } = created

    ws.send({
      v: 1,
      type: 'task.create',
      id: 'q1',
      ts: 1,
      payload: createPayload(handle, 'node -e "process.exit(0)"'),
    })
    const createdAck = await ws.next('ack')
    const taskId = (createdAck.payload as { data: { taskId: string } }).data.taskId

    ws.send({ v: 1, type: 'task.enqueue', id: 'q2', ts: 1, payload: { taskId } })
    await ws.next('ack')

    await nextStatus(ws, taskId, 'waiting_input')
    expect(handle.runtime.getTask(taskId)?.waitingReason).toBe('question')

    ws.send({
      v: 1,
      type: 'session.reply',
      id: 'q3',
      ts: 1,
      payload: { taskId, text: 'use option B' },
    })
    await ws.next('ack')

    const verify = await ws.next('verify.result', 10_000)
    const verifyPayload = verify.payload as { reviewId: string; exitCode: number }
    expect(verifyPayload.exitCode).toBe(0)

    ws.send({
      v: 1,
      type: 'review.decide',
      id: 'q4',
      ts: 1,
      payload: { reviewId: verifyPayload.reviewId, decision: 'approve' },
    })
    await ws.next('ack')
    await nextStatus(ws, taskId, 'done')
    expect(handle.runtime.getTask(taskId)?.status).toBe('done')
  })
})
