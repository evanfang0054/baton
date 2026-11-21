import { FakeAdapter, type FakeStep } from '@baton/adapters'
import { afterEach, describe, expect, it } from 'vitest'
import { listSessionsByTask } from '../src/db/repositories.js'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'
import { waitFor } from './helpers/async.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(script: FakeStep[]): TestRuntimeHandle {
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

describe('session usage', () => {
  it('persists cost and turns from a custom usage event', async () => {
    const handle = setup([{ kind: 'usage', costUsd: 0.42, turns: 3 }, { kind: 'finish' }])
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => listSessionsByTask(handle.database.db, taskId).at(-1)?.status === 'ended')

    const sessions = listSessionsByTask(handle.database.db, taskId)
    expect(sessions.at(-1)?.costUsd).toBe(0.42)
    expect(sessions.at(-1)?.turns).toBe(3)
  })

  it('keeps existing values when a later usage event omits fields', async () => {
    const handle = setup([
      { kind: 'usage', costUsd: 0.42, turns: 3 },
      { kind: 'usage', costUsd: 0.5 },
      { kind: 'finish' },
    ])
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => listSessionsByTask(handle.database.db, taskId).at(-1)?.status === 'ended')

    const sessions = listSessionsByTask(handle.database.db, taskId)
    expect(sessions.at(-1)?.costUsd).toBe(0.5)
    expect(sessions.at(-1)?.turns).toBe(3)
  })
})
