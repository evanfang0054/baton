import { describe, expect, it } from 'vitest'
import { listApprovalsByTask, listNotices } from '../src/db/repositories.js'
import { waitFor } from './helpers/async.js'
import { createTestRuntime } from './helpers/runtime.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(): TestRuntimeHandle {
  const handle = createTestRuntime({ useSessionRunner: true, trusted: true, maxConcurrency: 2 })
  handles.push(handle)
  return handle
}

describe('automation daemon integration', () => {
  it('runs policy → auto approval → digest → kill switch in one flow', async () => {
    const handle = setup()
    const workspaceId = handle.seeded.workspaceId

    handle.runtime.automation.patchPolicy(workspaceId, {
      autopilot: { enabled: true, retryMax: 0 },
      approval: { autoApproveMaxRisk: 'medium' },
    })

    const first = handle.createTask()
    handle.runtime.applyTransition(first, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(first)?.status === 'verifying')
    expect(listApprovalsByTask(handle.database.db, first)[0]?.decidedBy).toBe('auto')

    const notice = handle.runtime.digest.generate(workspaceId, 'manual')
    expect(notice?.kind).toBe('digest')
    expect(listNotices(handle.database.db, { workspaceId, limit: 10 })).toHaveLength(1)

    handle.runtime.automation.setKillSwitch(true)
    const second = handle.createTask({ title: 'second' })
    handle.runtime.applyTransition(second, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(second)?.status === 'waiting_input')
    expect(listApprovalsByTask(handle.database.db, second)[0]?.decision).toBeNull()
  })
})
