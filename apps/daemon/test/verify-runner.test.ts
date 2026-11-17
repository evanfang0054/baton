import { afterEach, describe, expect, it } from 'vitest'
import { waitFor } from './helpers/async.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(): TestRuntimeHandle {
  const handle = createTestRuntime({ useSessionRunner: true, useVerifyRunner: true })
  handles.push(handle)
  return handle
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

describe('verify runner', () => {
  it('runs verify and creates a review row on success', async () => {
    const handle = setup()
    const taskId = handle.createTask({ verifyCommand: 'node -e "process.exit(0)"' })
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input', 5000)
    const approval = handle.database.raw
      .prepare('select id from approval where session_id = ?')
      .get(
        (
          handle.database.raw.prepare('select id from session where task_id = ?').get(taskId) as {
            id: string
          }
        ).id,
      ) as { id: string }
    handle.runtime.decideApproval({ approvalId: approval.id, decision: 'allow' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'review', 5000)

    const review = handle.runtime.getReviewByTask(taskId)
    expect(review?.verifyExitCode).toBe(0)
    expect(handle.events.map((event) => event.type)).toContain('verify.result')
  })

  it('creates a failed review when verify exits non-zero', async () => {
    const handle = setup()
    const taskId = handle.createTask({ verifyCommand: 'node -e "process.exit(3)"' })
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input', 5000)
    const session = handle.database.raw
      .prepare('select id from session where task_id = ?')
      .get(taskId) as { id: string }
    const approval = handle.database.raw
      .prepare('select id from approval where session_id = ?')
      .get(session.id) as { id: string }
    handle.runtime.decideApproval({ approvalId: approval.id, decision: 'allow' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'review', 5000)

    const review = handle.runtime.getReviewByTask(taskId)
    expect(review?.verifyExitCode).toBe(3)
  })
})
