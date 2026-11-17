import { FakeAdapter, type FakeStep } from '@baton/adapters'
import { afterEach, describe, expect, it } from 'vitest'
import { listSessionsByTask } from '../src/db/repositories.js'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'
import { waitFor } from './helpers/async.js'
import { createTestRuntime, type TestRuntimeHandle } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(script: FakeStep[]) {
  const handle = createTestRuntime({
    useSessionRunner: true,
    adapters: createAdapterFactory({ fake: new FakeAdapter({ script }) }),
  })
  handles.push(handle)
  return handle
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

describe('session runner attention', () => {
  it('blocked -> waiting_input(question) -> reply -> verifying', async () => {
    const handle = setup([
      { kind: 'text', text: 'need a decision' },
      { kind: 'pause', outcome: 'blocked' },
      { kind: 'finish' },
    ])
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })

    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input')
    expect(handle.runtime.getTask(taskId)?.waitingReason).toBe('question')
    const paused = listSessionsByTask(handle.database.db, taskId)[0]
    expect(paused?.status).toBe('waiting_input')
    expect(paused?.outcome).toBeNull()

    const replied = handle.runtime.handleCommand({
      v: 1,
      id: 'reply-1',
      ts: 1,
      type: 'session.reply',
      payload: { taskId, text: 'use option B' },
    })
    expect(replied.ok).toBe(true)

    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'verifying')
    expect(handle.events.some((event) => event.type === 'task.status')).toBe(true)
  })

  it('dropped -> waiting_input(dropped) and can be cancelled', async () => {
    const handle = setup([{ kind: 'pause', outcome: 'dropped' }, { kind: 'finish' }])
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })

    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input')
    expect(handle.runtime.getTask(taskId)?.waitingReason).toBe('dropped')

    const cancelled = handle.runtime.cancel(taskId, 'not needed')
    expect(cancelled.ok).toBe(true)
    expect(handle.runtime.getTask(taskId)?.status).toBe('cancelled')
  })

  it('missing outcome -> waiting_input(stalled), not failed', async () => {
    const handle = setup([{ kind: 'finish', outcome: 'unreported' }])
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })

    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input')
    expect(handle.runtime.getTask(taskId)?.waitingReason).toBe('stalled')
    const session = listSessionsByTask(handle.database.db, taskId)[0]
    expect(session?.status).toBe('ended')
    expect(session?.outcome).toBe('unreported')
  })

  it('RUN_ERROR -> failed', async () => {
    const handle = setup([{ kind: 'error', message: 'boom' }])
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })

    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'failed')
    const session = listSessionsByTask(handle.database.db, taskId)[0]
    expect(session?.status).toBe('failed')
    expect(session?.outcome).toBeNull()
  })
})
