import { afterEach, describe, expect, it } from 'vitest'
import { updateWorkspaceTrust } from '../src/db/repositories.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(config: Parameters<typeof createTestRuntime>[0] = {}): TestRuntimeHandle {
  const handle = createTestRuntime({ maxConcurrency: 3, ...config })
  handles.push(handle)
  return handle
}

function trust(handle: TestRuntimeHandle, trusted: boolean, projectHooks: 'off' | 'on'): void {
  handle.database.db.transaction((tx) =>
    updateWorkspaceTrust(tx, handle.seeded.workspaceId, {
      trusted,
      projectHooks,
      trustedAt: trusted ? 2 : null,
    }),
  )
}

async function startTask(handle: TestRuntimeHandle): Promise<void> {
  const taskId = handle.createTask()
  handle.runtime.applyTransition(taskId, { type: 'enqueue' })
  await handle.runtime.settle()
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

describe('workspace trust snapshot', () => {
  it('never loads project settings or hooks for an untrusted workspace', async () => {
    const handle = setup()
    trust(handle, false, 'on')
    await startTask(handle)
    expect(handle.startSessions[0]?.workspaceTrust).toEqual({
      projectSettings: false,
      projectHooks: false,
    })
  })

  it('loads project settings and hooks only when trusted and enabled', async () => {
    const handle = setup()
    trust(handle, true, 'on')
    await startTask(handle)
    expect(handle.startSessions[0]?.workspaceTrust).toEqual({
      projectSettings: true,
      projectHooks: true,
    })
  })

  it('keeps hooks off when the workspace disables them', async () => {
    const handle = setup()
    trust(handle, true, 'off')
    await startTask(handle)
    expect(handle.startSessions[0]?.workspaceTrust).toEqual({
      projectSettings: true,
      projectHooks: false,
    })
  })

  it('honours the global hooks kill switch', async () => {
    const handle = setup({ config: { claudeProjectHooks: 'off' } })
    trust(handle, true, 'on')
    await startTask(handle)
    expect(handle.startSessions[0]?.workspaceTrust).toEqual({
      projectSettings: true,
      projectHooks: false,
    })
  })
})
