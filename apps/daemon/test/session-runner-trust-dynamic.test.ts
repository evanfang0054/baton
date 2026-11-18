import { FakeAdapter } from '@baton/adapters'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'
import { getWorkspace, listApprovalsByTask } from '../src/db/repositories.js'
import { waitFor } from './helpers/async.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

describe('session runner trust', () => {
  it('re-reads workspace trust for every approval', async () => {
    const adapter = new FakeAdapter({
      script: [
        {
          kind: 'approval',
          request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' },
        },
        { kind: 'pause', outcome: 'blocked', reason: 'need input' },
        {
          kind: 'approval',
          request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' },
        },
        { kind: 'finish' },
      ],
    })
    const handle = createTestRuntime({
      useSessionRunner: true,
      adapters: createAdapterFactory({ fake: adapter }),
    })
    handles.push(handle)
    mkdirSync(join(handle.root, handle.seeded.relPath, '.baton'))
    writeFileSync(
      join(handle.root, handle.seeded.relPath, '.baton', 'policy.json'),
      JSON.stringify({
        autopilot: { enabled: true, retryMax: 1 },
        approval: { autoApproveMaxRisk: 'medium' },
      }),
    )

    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input')

    const first = listApprovalsByTask(handle.database.db, taskId)[0]
    expect(first?.decidedBy).toBe('auto')

    handle.database.raw
      .prepare('update workspace set trusted = 0 where id = ?')
      .run(handle.seeded.workspaceId)
    expect(getWorkspace(handle.database.db, handle.seeded.workspaceId)?.trusted).toBe(false)
    handle.runtime.applyTransition(taskId, { type: 'user_input', text: 'continue' })
    await waitFor(() => listApprovalsByTask(handle.database.db, taskId).length === 2)

    const second = listApprovalsByTask(handle.database.db, taskId).find(
      (item) => item.requestId === 'req-2',
    )
    expect(second?.decision).toBeNull()
    expect(second?.decidedBy).toBeNull()
  })
})
