import { FakeAdapter } from '@baton/adapters'
import { afterEach, describe, expect, it } from 'vitest'
import { getTaskDetail } from '../src/db/repositories.js'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'
import { waitFor } from './helpers/async.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(options: { maxConcurrency?: number } = {}): TestRuntimeHandle {
  const handle = createTestRuntime(options)
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

  it('keeps FIFO order when injecting into a queued task', () => {
    const handle = setup({ maxConcurrency: 0 })
    const first = handle.createTask()
    const second = handle.createTask()
    handle.runtime.applyTransition(first, { type: 'enqueue' })
    handle.runtime.applyTransition(second, { type: 'enqueue' })
    const firstEnqueuedAt = handle.runtime.getTask(first)?.enqueuedAt
    expect(firstEnqueuedAt).toBeTypeOf('number')
    expect(handle.runtime.findNextQueued()?.id).toBe(first)

    const outcome = handle.runtime.handleCommand({
      v: 1,
      id: 'c-order',
      ts: 1,
      type: 'context.inject',
      payload: { taskId: first, nodeIds: ['text-1'] },
    })
    expect(outcome.ok).toBe(true)
    expect(handle.runtime.getTask(first)?.enqueuedAt).toBe(firstEnqueuedAt)
    expect(handle.runtime.findNextQueued()?.id).toBe(first)
  })

  it('feeds a waiting_input session through user_input with one context block', async () => {
    const handle = createTestRuntime({
      useSessionRunner: true,
      adapters: createAdapterFactory({
        fake: new FakeAdapter({
          script: [{ kind: 'pause', outcome: 'blocked' }, { kind: 'finish' }],
        }),
      }),
    })
    handles.push(handle)
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input')

    const outcome = handle.runtime.handleCommand({
      v: 1,
      id: 'c3',
      ts: 1,
      type: 'context.inject',
      payload: { taskId, nodeIds: ['text-1'], note: '补充' },
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.ack).toMatchObject({ taskId, seq: 1 })
    }

    const detail = getTaskDetail(handle.database.db, taskId)
    expect(detail?.task.status).toBe('running')
    expect(detail?.task.prompt.match(/<user_reply>/g)).toHaveLength(1)
    expect(detail?.task.prompt.match(/<context_update/g)).toHaveLength(1)
    expect(detail?.task.prompt).toContain('<note>补充</note>')
    expect(detail?.task.context?.injections).toHaveLength(1)
    const audit = handle.database.raw
      .prepare("select count(*) as count from audit where action = 'task.context.inject'")
      .get() as { count: number }
    expect(audit.count).toBe(1)
    expect(handle.events.map((event) => event.type)).toContain('context.injected')
  })
})
