import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildMandate } from '@baton/core'
import type { TaskOrigin } from '@baton/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { listNotices } from '../src/db/repositories.js'
import { createTestRuntime, type TestRuntimeHandle } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

function origin(
  handle: TestRuntimeHandle,
  allowedActions: TaskOrigin['allowedActions'],
): TaskOrigin {
  const mandate = buildMandate({
    strength: 'explicit',
    allowedActions: allowedActions ?? [],
    policyVersion: 'policy-1',
    promptVersion: 'prompt-1',
  })
  return {
    source: 'supervisor-chat',
    triggerId: 'trigger-1',
    threadId: 'thread-1',
    actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
    workspaceId: handle.seeded.workspaceId,
    targetNodeId: handle.seeded.nodeId,
    contextNodeIds: [],
    createdAt: 1,
    ...mandate,
  }
}

function setup(status: 'failed' | 'done' = 'failed') {
  const handle = createTestRuntime()
  handles.push(handle)
  const taskId = handle.createTask()
  handle.database.raw.prepare('update task set status = ? where id = ?').run(status, taskId)
  return { handle, taskId }
}

describe('M6-5 governance', () => {
  it('rejects retry after the mandate no longer allows it, then succeeds after reauthorize', () => {
    const { handle, taskId } = setup()
    handle.database.raw
      .prepare('update task set origin_json = ? where id = ?')
      .run(JSON.stringify(origin(handle, ['reopen', 'enqueue'])), taskId)

    const revoked = handle.runtime.handleCommand({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'task.retry',
      payload: { taskId },
    })
    expect(revoked).toMatchObject({ ok: false, error: { code: 'mandate_revoked' } })
    expect(handle.runtime.getTask(taskId)?.status).toBe('failed')

    const reauthorized = handle.runtime.handleCommand({
      v: 1,
      id: 'c2',
      ts: 1,
      type: 'task.reauthorize',
      payload: { taskId },
    })
    expect(reauthorized.ok).toBe(true)

    const retried = handle.runtime.handleCommand({
      v: 1,
      id: 'c3',
      ts: 1,
      type: 'task.retry',
      payload: { taskId },
    })
    expect(retried.ok).toBe(true)
    expect(handle.runtime.getTask(taskId)?.status).not.toBe('failed')
  })

  it('observe writes a proposed retry without changing task state', () => {
    const { handle, taskId } = setup()
    handle.database.raw
      .prepare('update task set origin_json = ? where id = ?')
      .run(JSON.stringify(origin(handle, ['retry', 'reopen', 'enqueue'])), taskId)
    mkdirSync(join(handle.root, handle.seeded.relPath, '.baton'), { recursive: true })
    writeFileSync(
      join(handle.root, handle.seeded.relPath, '.baton', 'policy.json'),
      JSON.stringify({
        autonomy: { mode: 'observe', autoRetry: 'observe', attentionReminder: 'observe' },
      }),
    )

    handle.runtime.supervisor.observeTask({
      taskId,
      status: 'failed',
      waitingReason: null,
    })
    expect(handle.runtime.getTask(taskId)?.status).toBe('failed')
    expect(handle.runtime.actions.listProposed(handle.seeded.workspaceId)).toHaveLength(1)
  })

  it('attentionReminder auto generates a digest with the failure item', () => {
    const { handle, taskId } = setup()
    handle.database.raw
      .prepare('update task set origin_json = ? where id = ?')
      .run(JSON.stringify(origin(handle, ['retry', 'reopen', 'enqueue'])), taskId)
    mkdirSync(join(handle.root, handle.seeded.relPath, '.baton'), { recursive: true })
    writeFileSync(
      join(handle.root, handle.seeded.relPath, '.baton', 'policy.json'),
      JSON.stringify({
        autonomy: { mode: 'auto', autoRetry: 'off', attentionReminder: 'auto' },
      }),
    )

    handle.runtime.supervisor.observeTask({
      taskId,
      status: 'failed',
      waitingReason: null,
    })
    const notices = listNotices(handle.database.db, {
      workspaceId: handle.seeded.workspaceId,
      kind: 'digest',
      limit: 5,
    })
    expect(notices).toHaveLength(1)
    expect(notices[0]?.payload).toMatchObject({
      attention: { items: [{ kind: 'failed' }] },
    })
  })
})
