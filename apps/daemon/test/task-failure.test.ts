import { afterEach, describe, expect, it } from 'vitest'
import { createFailureService } from '../src/failures/service.js'
import { createTestDb, seedTask, type TestDb } from './helpers/db.js'

const dbs: TestDb[] = []
afterEach(() => dbs.splice(0).forEach((entry) => entry.raw.close()))

describe('failure service', () => {
  it('redacts and keeps only the latest 20 rows per task', () => {
    const database = createTestDb()
    dbs.push(database)
    const seeded = seedTask(database.raw, { taskStatus: 'failed' })
    let now = 1
    let id = 0
    const service = createFailureService({
      db: database.db,
      now: () => now++,
      newId: () => `f-${++id}`,
      workspaceRoot: () => null,
    })
    for (let index = 0; index < 25; index += 1) {
      service.record({
        workspaceId: seeded.workspaceId,
        taskId: seeded.taskId,
        sessionId: seeded.sessionId,
        attempt: index,
        stage: 'run',
        message: `token=secret failed at <workspace>/src/${index}.ts`,
        retryable: true,
        affectedPaths: [`src/${index}.ts`, '/abs/secret.ts'],
      })
    }
    const rows = service.list(seeded.taskId, 20)
    expect(rows).toHaveLength(20)
    expect(rows[0]?.lastError).not.toContain('secret')
    expect(rows[0]?.affectedPaths).toEqual(['src/24.ts'])
    expect(service.latest(seeded.taskId)?.stage).toBe('run')
    expect(service.latestByTaskIds([seeded.taskId]).get(seeded.taskId)?.summary).toBeTruthy()
  })
})
