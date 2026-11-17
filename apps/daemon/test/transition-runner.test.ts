import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getApproval, insertApproval } from '../src/db/repositories.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(options?: { maxConcurrency?: number }): TestRuntimeHandle {
  const handle = createTestRuntime(options)
  handles.push(handle)
  return handle
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

describe('transition runner', () => {
  it('enqueues and lets the scheduler start the task', async () => {
    const handle = setup()
    const taskId = handle.createTask()
    const outcome = handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) {
      return
    }
    expect(outcome.status).toBe('queued')
    expect(outcome.events.at(-1)?.type).toBe('task.status')

    await handle.runtime.settle()
    expect(handle.runtime.getTask(taskId)?.status).toBe('running')
    expect(handle.startSessions).toHaveLength(1)
    expect(handle.startSessions[0]?.taskId).toBe(taskId)
  })

  it('rejects start when the concurrency slot is full', async () => {
    const handle = setup({ maxConcurrency: 1 })
    const first = handle.createTask({ title: 'one' })
    const second = handle.createTask({ title: 'two' })
    handle.runtime.applyTransition(first, { type: 'enqueue' })
    handle.runtime.applyTransition(second, { type: 'enqueue' })
    await handle.runtime.settle()

    expect(handle.runtime.getTask(first)?.status).toBe('running')
    expect(handle.runtime.getTask(second)?.status).toBe('queued')

    const outcome = handle.runtime.applyTransition(second, { type: 'start' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('guard_failed')
    }
    expect(handle.runtime.getTask(second)?.status).toBe('queued')
  })

  it('retries verify failures when autopilot is enabled', async () => {
    const handle = setup()
    const taskId = handle.createTask()
    mkdirSync(join(handle.root, handle.seeded.relPath, '.baton'))
    writeFileSync(
      join(handle.root, handle.seeded.relPath, '.baton', 'policy.json'),
      JSON.stringify({ autopilot: { enabled: true, retryMax: 2 } }),
    )

    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await handle.runtime.settle()
    handle.runtime.applyTransition(taskId, { type: 'completed' })
    await handle.runtime.settle()
    expect(handle.runtime.getTask(taskId)?.status).toBe('verifying')

    const outcome = handle.runtime.applyTransition(taskId, {
      type: 'verify_fail',
      reviewId: 'review-1',
      exitCode: 1,
      output: 'boom',
      diffStat: { filesChanged: 1, insertions: 1, deletions: 0 },
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) {
      return
    }
    expect(outcome.status).toBe('queued')
    expect(outcome.retryCount).toBe(1)
    expect(outcome.events.map((event) => event.type)).toEqual(['verify.result', 'task.status'])
    expect(handle.runtime.getTask(taskId)?.retryCount).toBe(1)
    expect(handle.runtime.getTask(taskId)?.prompt).toContain('<feedback>')
    expect(handle.runtime.getReviewByTask(taskId)?.verifyExitCode).toBe(1)

    await handle.runtime.settle()
    expect(handle.runtime.getTask(taskId)?.status).toBe('running')
  })

  it('moves verify_ok into review and approves it', async () => {
    const handle = setup()
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await handle.runtime.settle()
    handle.runtime.applyTransition(taskId, { type: 'completed' })
    await handle.runtime.settle()

    const verified = handle.runtime.applyTransition(taskId, {
      type: 'verify_ok',
      reviewId: 'review-1',
      exitCode: 0,
      output: 'ok',
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    })
    expect(verified.ok).toBe(true)
    if (verified.ok) {
      expect(verified.status).toBe('review')
    }
    const review = handle.runtime.getReviewByTask(taskId)
    expect(review?.verifyExitCode).toBe(0)

    const decided = handle.runtime.decideReview({ reviewId: 'review-1', decision: 'approve' })
    expect(decided.ok).toBe(true)
    if (decided.ok) {
      expect(decided.status).toBe('done')
    }
    expect(handle.runtime.getReviewByTask(taskId)?.verdict).toBe('approved')
  })

  it('rejects a review that has been superseded by a newer attempt', async () => {
    const handle = setup()
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await handle.runtime.settle()
    handle.runtime.applyTransition(taskId, { type: 'completed' })
    await handle.runtime.settle()
    handle.runtime.applyTransition(taskId, {
      type: 'verify_ok',
      reviewId: 'review-1',
      exitCode: 0,
      output: 'ok',
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    })
    handle.database.raw
      .prepare(
        `insert into review (id, task_id, verdict, verify_exit_code, verify_output, diff_stat_json, decided_at)
         values ('review-2', ?, null, 1, 'fail', '{"filesChanged":0,"insertions":0,"deletions":0}', null)`,
      )
      .run(taskId)

    const outcome = handle.runtime.decideReview({ reviewId: 'review-1', decision: 'approve' })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('review_expired')
    }
  })

  it('asks for approval and resumes after allow', async () => {
    const handle = setup()
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await handle.runtime.settle()
    const sessionId = handle.startSessions[0]!.sessionId
    handle.database.db.transaction((tx) =>
      insertApproval(tx, {
        id: 'approval-1',
        sessionId,
        requestId: 'req-1',
        request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' },
      }),
    )

    const requested = handle.runtime.applyTransition(taskId, {
      type: 'approval_requested',
      approvalId: 'approval-1',
    })
    expect(requested.ok).toBe(true)
    if (!requested.ok) {
      return
    }
    expect(requested.status).toBe('waiting_input')
    expect(requested.events.map((event) => event.type)).toEqual(['approval.request', 'task.status'])
    expect(handle.runtime.getSession(sessionId)?.status).toBe('waiting_input')

    const decided = handle.runtime.decideApproval({
      approvalId: 'approval-1',
      decision: 'allow',
    })
    expect(decided.ok).toBe(true)
    if (!decided.ok) {
      return
    }
    expect(decided.status).toBe('running')
    await handle.runtime.settle()
    expect(handle.approvals).toEqual([{ approvalId: 'approval-1', decision: 'allow' }])
    expect(getApproval(handle.database.db, 'approval-1')?.decision).toBe('allow')
  })

  it('starts the next queued task after the first enters review', async () => {
    const handle = setup({ maxConcurrency: 1 })
    const first = handle.createTask({ title: 'one' })
    const second = handle.createTask({ title: 'two' })
    handle.runtime.applyTransition(first, { type: 'enqueue' })
    handle.runtime.applyTransition(second, { type: 'enqueue' })
    await handle.runtime.settle()
    expect(handle.runtime.getTask(first)?.status).toBe('running')
    expect(handle.runtime.getTask(second)?.status).toBe('queued')

    handle.runtime.applyTransition(first, { type: 'completed' })
    await handle.runtime.settle()
    handle.runtime.applyTransition(first, {
      type: 'verify_ok',
      reviewId: 'review-1',
      exitCode: 0,
      output: 'ok',
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    })
    await handle.runtime.settle()
    expect(handle.runtime.getTask(first)?.status).toBe('review')
    expect(handle.runtime.getTask(second)?.status).toBe('running')
  })

  it('starts the next queued task after the first settles', async () => {
    const handle = setup({ maxConcurrency: 1 })
    const first = handle.createTask({ title: 'one' })
    const second = handle.createTask({ title: 'two' })
    handle.runtime.applyTransition(first, { type: 'enqueue' })
    handle.runtime.applyTransition(second, { type: 'enqueue' })
    await handle.runtime.settle()
    expect(handle.runtime.getTask(first)?.status).toBe('running')
    expect(handle.runtime.getTask(second)?.status).toBe('queued')

    handle.runtime.cancel(first, 'done with first')
    await handle.runtime.settle()
    expect(handle.runtime.getTask(first)?.status).toBe('cancelled')
    expect(handle.runtime.getTask(second)?.status).toBe('running')
  })

  it('counts verifying as an active slot', async () => {
    const handle = setup({ maxConcurrency: 1 })
    const first = handle.createTask({ title: 'one' })
    const second = handle.createTask({ title: 'two' })
    handle.runtime.applyTransition(first, { type: 'enqueue' })
    await handle.runtime.settle()
    handle.runtime.applyTransition(first, { type: 'completed' })
    await handle.runtime.settle()
    handle.runtime.applyTransition(second, { type: 'enqueue' })
    await handle.runtime.settle()

    expect(handle.runtime.getTask(first)?.status).toBe('verifying')
    expect(handle.runtime.getTask(second)?.status).toBe('queued')
  })

  it('cancels a running task and interrupts the session', async () => {
    const handle = setup()
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await handle.runtime.settle()

    const outcome = handle.runtime.cancel(taskId, 'user cancelled')
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.status).toBe('cancelled')
    }
    await handle.runtime.settle()
    expect(handle.runtime.getTask(taskId)?.status).toBe('cancelled')
    expect(handle.interrupts).toEqual([taskId])
  })

  it('rejects a review and re-enqueues with feedback', async () => {
    const handle = setup()
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await handle.runtime.settle()
    handle.runtime.applyTransition(taskId, { type: 'completed' })
    await handle.runtime.settle()
    handle.runtime.applyTransition(taskId, {
      type: 'verify_ok',
      reviewId: 'review-1',
      exitCode: 0,
      output: 'ok',
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    })

    const outcome = handle.runtime.decideReview({
      reviewId: 'review-1',
      decision: 'reject',
      feedback: '请修复登录页',
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) {
      return
    }
    expect(outcome.status).toBe('queued')
    expect(handle.runtime.getTask(taskId)?.prompt).toContain('<feedback>')
    expect(handle.runtime.getTask(taskId)?.prompt).toContain('请修复登录页')
    expect(handle.runtime.getReviewByTask(taskId)?.verdict).toBe('rejected')

    await handle.runtime.settle()
    expect(handle.runtime.getTask(taskId)?.status).toBe('running')
  })
})
