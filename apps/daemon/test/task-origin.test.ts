import { TaskOrigin } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { getTaskDetail } from '../src/db/repositories.js'
import { createTestDb, seedTask } from './helpers/db.js'

describe('task origin', () => {
  it('returns null for old tasks', () => {
    const database = createTestDb()
    const seeded = seedTask(database.raw)
    const detail = getTaskDetail(database.db, seeded.taskId)
    expect(detail?.task.origin).toBeNull()
    expect(detail?.originInvalid).toBe(false)
    database.raw.close()
  })

  it('parses a valid origin and degrades on invalid json', () => {
    const database = createTestDb()
    const seeded = seedTask(database.raw)
    const origin = TaskOrigin.parse({
      source: 'supervisor-chat',
      triggerId: 'r1',
      threadId: 'th1',
      actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
      workspaceId: seeded.workspaceId,
      targetNodeId: seeded.nodeId,
      contextNodeIds: [],
      policyVersion: 'p1',
      promptVersion: 'v1',
      createdAt: 1,
    })
    database.raw
      .prepare('UPDATE task SET origin_json = ? WHERE id = ?')
      .run(JSON.stringify(origin), seeded.taskId)
    expect(getTaskDetail(database.db, seeded.taskId)?.task.origin?.triggerId).toBe('r1')

    database.raw
      .prepare('UPDATE task SET origin_json = ? WHERE id = ?')
      .run('{bad json', seeded.taskId)
    const invalid = getTaskDetail(database.db, seeded.taskId)
    expect(invalid?.task.origin).toBeNull()
    expect(invalid?.originInvalid).toBe(true)
    database.raw.close()
  })
})
