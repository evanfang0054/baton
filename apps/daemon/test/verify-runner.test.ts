import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'
import { getReviewDiff } from '../src/db/repositories.js'
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

  it('persists a diff snapshot on verify', async () => {
    const handle = setup()
    const workspace = join(handle.root, handle.seeded.relPath)
    await execa('git', ['-C', workspace, 'init', '-q'])
    await execa('git', ['-C', workspace, 'config', 'user.email', 'test@example.com'])
    await execa('git', ['-C', workspace, 'config', 'user.name', 'test'])
    writeFileSync(join(workspace, 'a.txt'), 'hello\n')
    await execa('git', ['-C', workspace, 'add', '-A'])
    await execa('git', ['-C', workspace, 'commit', '-qm', 'init'])
    writeFileSync(join(workspace, 'a.txt'), 'hello world\n')

    const taskId = handle.createTask({ verifyCommand: 'node -e "process.exit(0)"' })
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

    const review = handle.runtime.getReviewByTask(taskId)!
    const snapshot = getReviewDiff(handle.database.db, review.id)
    expect(snapshot?.files.find((file) => file.path === 'a.txt')?.patch).toContain('+hello world')
  })
})
