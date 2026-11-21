import { describe, expect, it } from 'vitest'
import { getTaskDetail, listAudit } from '../src/db/repositories.js'
import { createTestRuntime } from './helpers/runtime.js'

describe('context.inject idempotency', () => {
  it('writes one injection for the same requestId', async () => {
    const handle = createTestRuntime()
    const taskId = handle.seeded.taskId
    const payload = {
      taskId,
      nodeIds: ['text-1'],
      note: '补需求',
      requestId: 'req-1',
    }

    const first = handle.runtime.handleCommand({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'context.inject',
      payload,
    })
    const second = handle.runtime.handleCommand({
      v: 1,
      id: 'c2',
      ts: 1,
      type: 'context.inject',
      payload,
    })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.ack).toMatchObject({ seq: 1, duplicate: true })

    const detail = getTaskDetail(handle.database.db, taskId)
    expect(detail?.task.context?.injections).toHaveLength(1)
    expect(detail?.task.context?.injections[0]).toMatchObject({ requestId: 'req-1' })
    expect(
      listAudit(handle.database.db, { actionPrefix: 'task.context.inject', limit: 10 }),
    ).toHaveLength(1)
    await handle.cleanup()
  })

  it('treats different requestIds as separate injections', async () => {
    const handle = createTestRuntime()
    const taskId = handle.seeded.taskId
    for (const requestId of ['req-1', 'req-2']) {
      const result = handle.runtime.handleCommand({
        v: 1,
        id: requestId,
        ts: 1,
        type: 'context.inject',
        payload: { taskId, nodeIds: ['text-1'], requestId },
      })
      expect(result.ok).toBe(true)
    }
    expect(getTaskDetail(handle.database.db, taskId)?.task.context?.injections).toHaveLength(2)
    await handle.cleanup()
  })
})
