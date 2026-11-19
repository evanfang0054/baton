import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listApprovalsByTask } from '../src/db/repositories.js'
import { waitFor } from './helpers/async.js'
import { createTestRuntime } from './helpers/runtime.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function writePolicy(handle: TestRuntimeHandle): void {
  mkdirSync(join(handle.root, handle.seeded.relPath, '.baton'))
  writeFileSync(
    join(handle.root, handle.seeded.relPath, '.baton', 'policy.json'),
    JSON.stringify({
      autopilot: { enabled: true, retryMax: 1 },
      approval: { autoApproveMaxRisk: 'medium' },
    }),
  )
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

describe('automation runtime', () => {
  it('stops auto-approving immediately after kill switch is enabled', async () => {
    const handle = createTestRuntime({ useSessionRunner: true, trusted: true })
    handles.push(handle)
    writePolicy(handle)
    handle.runtime.automation.setKillSwitch(true)

    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input')

    const approval = listApprovalsByTask(handle.database.db, taskId)[0]
    expect(approval?.decision).toBeNull()
    expect(approval?.decidedBy).toBeNull()
  })

  it('does not retry verify_fail when kill switch is on', () => {
    const handle = createTestRuntime({ trusted: true })
    handles.push(handle)
    writePolicy(handle)
    handle.database.raw
      .prepare("update task set status = 'verifying' where id = ?")
      .run(handle.seeded.taskId)
    handle.runtime.automation.setKillSwitch(true)

    const outcome = handle.runtime.applyTransition(handle.seeded.taskId, {
      type: 'verify_fail',
      reviewId: 'review-1',
      exitCode: 1,
      output: 'boom',
      diffStat: { filesChanged: 1, insertions: 1, deletions: 0 },
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.status).toBe('review')
  })

  it('uses the policy snapshot captured at start for verify_fail retry', async () => {
    const handle = createTestRuntime({ trusted: true })
    handles.push(handle)
    writePolicy(handle)
    const taskId = handle.seeded.taskId
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'running')

    writeFileSync(
      join(handle.root, handle.seeded.relPath, '.baton', 'policy.json'),
      JSON.stringify({ autopilot: { enabled: false } }),
    )
    handle.runtime.applyTransition(taskId, { type: 'completed' })
    const outcome = handle.runtime.applyTransition(taskId, {
      type: 'verify_fail',
      reviewId: 'review-2',
      exitCode: 1,
      output: 'boom',
      diffStat: { filesChanged: 1, insertions: 1, deletions: 0 },
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.status).toBe('queued')
  })
})
