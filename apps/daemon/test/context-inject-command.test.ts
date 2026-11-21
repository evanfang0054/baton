import { afterEach, describe, expect, it } from 'vitest'
import { getTaskDetail } from '../src/db/repositories.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(): TestRuntimeHandle {
  const handle = createTestRuntime()
  handles.push(handle)
  return handle
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

describe('context.inject command', () => {
  it('acks and writes prompt/context for todo', () => {
    const handle = setup()
    const taskId = handle.createTask()
    const outcome = handle.runtime.handleCommand({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'context.inject',
      payload: { taskId, nodeIds: ['text-1'], note: '补充' },
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.ack).toMatchObject({ taskId, seq: 1, truncated: false, dropped: 0 })
    }
    const detail = getTaskDetail(handle.database.db, taskId)
    expect(detail?.task.prompt).toContain('<context_update seq="1"')
    expect(detail?.task.prompt).toContain('<note>补充</note>')
    expect(detail?.task.context?.injections).toHaveLength(1)
    expect(handle.events.map((event) => event.type)).toContain('context.injected')
  })

  it('rejects review tasks because only review.decide may inject', () => {
    const handle = setup()
    const taskId = handle.createTask()
    handle.database.raw
      .prepare("update task set status = 'review', waiting_reason = null where id = ?")
      .run(taskId)

    const outcome = handle.runtime.handleCommand({
      v: 1,
      id: 'c2',
      ts: 1,
      type: 'context.inject',
      payload: { taskId, nodeIds: ['text-1'] },
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('task_not_injectable')
    }
    expect(getTaskDetail(handle.database.db, taskId)?.task.context?.injections ?? []).toHaveLength(
      0,
    )
  })
})
