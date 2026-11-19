import { afterEach, describe, expect, it } from 'vitest'
import {
  getApproval,
  getReviewByTask,
  insertApproval,
  listSessionsByTask,
} from '../src/db/repositories.js'
import { reconcileOnBoot } from '../src/runtime/boot.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(): TestRuntimeHandle {
  const handle = createTestRuntime({ maxConcurrency: 3 })
  handles.push(handle)
  return handle
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

describe('reconcileOnBoot', () => {
  it('marks active tasks stalled, keeps verify evidence and expires approvals', async () => {
    const handle = setup()
    const first = handle.createTask({ title: 'one' })
    const second = handle.createTask({ title: 'two' })
    const verifying = handle.createTask({ title: 'three' })

    for (const taskId of [first, second, verifying]) {
      handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    }
    await handle.runtime.settle()
    handle.runtime.applyTransition(verifying, { type: 'completed' })
    await handle.runtime.settle()

    const firstSession = listSessionsByTask(handle.database.db, first)[0]!
    handle.database.db.transaction((tx) =>
      insertApproval(tx, {
        id: 'approval-boot',
        sessionId: firstSession.id,
        requestId: 'req-boot',
        request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' },
      }),
    )

    reconcileOnBoot({
      db: handle.database.db,
      config: handle.config,
      applyTransition: handle.runtime.applyTransition,
      now: () => 99,
      newId: () => 'audit-boot',
    })

    expect(handle.runtime.getTask(first)?.status).toBe('waiting_input')
    expect(handle.runtime.getTask(first)?.waitingReason).toBe('stalled')
    expect(handle.runtime.getTask(second)?.status).toBe('waiting_input')
    expect(handle.runtime.getTask(second)?.waitingReason).toBe('stalled')
    expect(handle.runtime.getTask(verifying)?.status).toBe('review')
    const review = getReviewByTask(handle.database.db, verifying)
    expect(review?.verifyExitCode).toBe(124)
    expect(review?.verifyOutput).toContain('daemon restarted during verify')
    expect(listSessionsByTask(handle.database.db, first)[0]?.status).toBe('failed')
    expect(getApproval(handle.database.db, 'approval-boot')?.decision).toBe('deny')
    expect(getApproval(handle.database.db, 'approval-boot')?.decidedBy).toBe('system')

    const audit = handle.database.raw
      .prepare("select action from audit where action = 'approval.expired'")
      .get() as { action: string } | undefined
    expect(audit?.action).toBe('approval.expired')
  })

  it('fails an active worktree task when its directory is missing', () => {
    const handle = setup()
    const taskId = handle.createTask({ title: 'worktree' })
    handle.database.raw
      .prepare(
        "update task set status = 'running', workspace_mode = 'worktree', worktree_path = '/nonexistent/worktree' where id = ?",
      )
      .run(taskId)

    reconcileOnBoot({
      db: handle.database.db,
      config: handle.config,
      applyTransition: handle.runtime.applyTransition,
      now: () => 99,
      newId: () => 'audit-boot',
    })

    expect(handle.runtime.getTask(taskId)?.status).toBe('failed')
  })
})
