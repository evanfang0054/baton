import { afterEach, describe, expect, it } from 'vitest'
import { getTaskDetail, insertReview, updateTaskState } from '../src/db/repositories.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(): TestRuntimeHandle {
  const handle = createTestRuntime({ maxConcurrency: 0 })
  handles.push(handle)
  return handle
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

function seedReview(
  handle: TestRuntimeHandle,
  input: { reviewId: string; verifyExitCode: number; verdict?: 'approved' | 'rejected' | null },
): void {
  handle.database.db.transaction((tx) => {
    updateTaskState(tx, handle.seeded.taskId, 'review', 0, null, 2)
    insertReview(tx, {
      id: input.reviewId,
      taskId: handle.seeded.taskId,
      verdict: input.verdict ?? null,
      verifyExitCode: input.verifyExitCode,
      verifyOutput: '',
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      decidedAt: null,
    })
  })
}

describe('review context', () => {
  it('rejects with context only and queues the task', () => {
    const handle = setup()
    seedReview(handle, { reviewId: 'review-1', verifyExitCode: 0 })
    const outcome = handle.runtime.handleCommand({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'review.decide',
      payload: { reviewId: 'review-1', decision: 'reject', contextNodeIds: ['text-1'] },
    })
    expect(outcome.ok).toBe(true)
    const detail = getTaskDetail(handle.database.db, handle.seeded.taskId)
    expect(detail?.task.status).toBe('queued')
    expect(detail?.task.prompt).toContain('<feedback>')
    expect(detail?.task.prompt).toContain('<context_update seq="1"')
    expect(detail?.task.context?.injections).toHaveLength(1)
  })

  it('writes an approve override audit when verify failed', () => {
    const handle = setup()
    seedReview(handle, { reviewId: 'review-2', verifyExitCode: 1 })
    const outcome = handle.runtime.handleCommand({
      v: 1,
      id: 'c2',
      ts: 1,
      type: 'review.decide',
      payload: { reviewId: 'review-2', decision: 'approve', reason: '测试已手动通过' },
    })
    expect(outcome.ok).toBe(true)
    const audit = handle.database.raw
      .prepare("select actor, detail_json from audit where action = 'review.approve_override'")
      .get() as { actor: string; detail_json: string } | undefined
    expect(audit?.actor).toBe('human')
    expect(JSON.parse(audit!.detail_json)).toMatchObject({
      taskId: handle.seeded.taskId,
      reviewId: 'review-2',
      verifyExitCode: 1,
      reasonProvided: true,
    })
  })

  it('does not write an override audit for a clean approve', () => {
    const handle = setup()
    seedReview(handle, { reviewId: 'review-3', verifyExitCode: 0 })
    const outcome = handle.runtime.handleCommand({
      v: 1,
      id: 'c3',
      ts: 1,
      type: 'review.decide',
      payload: { reviewId: 'review-3', decision: 'approve' },
    })
    expect(outcome.ok).toBe(true)
    const audit = handle.database.raw
      .prepare("select count(*) as count from audit where action = 'review.approve_override'")
      .get() as { count: number }
    expect(audit.count).toBe(0)
  })
})
