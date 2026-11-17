import { afterEach, describe, expect, it } from 'vitest'
import type { TestRuntimeHandle } from './helpers/runtime.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(): TestRuntimeHandle {
  const handle = createTestRuntime({ useSessionRunner: true, useVerifyRunner: true })
  handles.push(handle)
  return handle
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

describe('verify runner', () => {
  it('runs verify and creates a review row on success', async () => {
    const handle = setup()
    const taskId = handle.createTask({ verifyCommand: 'node -e "process.exit(0)"' })
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input')
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
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'review')

    const review = handle.runtime.getReviewByTask(taskId)
    expect(review?.verifyExitCode).toBe(0)
    expect(handle.events.map((event) => event.type)).toContain('verify.result')
  })

  it('creates a failed review when verify exits non-zero', async () => {
    const handle = setup()
    const taskId = handle.createTask({ verifyCommand: 'node -e "process.exit(3)"' })
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input')
    const session = handle.database.raw
      .prepare('select id from session where task_id = ?')
      .get(taskId) as { id: string }
    const approval = handle.database.raw
      .prepare('select id from approval where session_id = ?')
      .get(session.id) as { id: string }
    handle.runtime.decideApproval({ approvalId: approval.id, decision: 'allow' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'review')

    const review = handle.runtime.getReviewByTask(taskId)
    expect(review?.verifyExitCode).toBe(3)
  })
})
