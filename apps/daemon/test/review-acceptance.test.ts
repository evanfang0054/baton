import { describe, expect, it } from 'vitest'
import { ensureAcceptanceForReview } from '../src/runtime/acceptance-service.js'
import {
  freezeAcceptanceContract,
  getAcceptanceBundle,
  insertAcceptanceItems,
} from '../src/db/acceptance-repository.js'
import { insertReview } from '../src/db/repositories.js'
import { createTestDb, seedTask } from './helpers/db.js'
import { createTestRuntime } from './helpers/runtime.js'

describe('review acceptance', () => {
  it('creates v1 draft and running run on first review', async () => {
    const handle = createTestRuntime()
    const taskId = handle.seeded.taskId
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    handle.runtime.applyTransition(taskId, { type: 'start' })
    handle.runtime.applyTransition(taskId, { type: 'completed' })
    handle.runtime.applyTransition(taskId, {
      type: 'verify_ok',
      reviewId: 'r1',
      exitCode: 0,
      output: '',
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    })

    const bundle = getAcceptanceBundle(handle.database.db, taskId)
    expect(bundle?.contract).toMatchObject({ version: 1, status: 'draft', revision: 0 })
    expect(bundle?.run).toMatchObject({ reviewId: 'r1', status: 'running' })
    await handle.cleanup()
  })

  it('clones the last frozen contract on re-review', () => {
    const database = createTestDb()
    const seeded = seedTask(database.raw)
    let counter = 0
    const newId = () => `id-${++counter}`
    const review = (id: string) =>
      database.db.transaction((tx) =>
        insertReview(tx, {
          id,
          taskId: seeded.taskId,
          verdict: null,
          verifyExitCode: 0,
          verifyOutput: '',
          diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
          decidedAt: null,
        }),
      )
    review('r1')

    let first!: ReturnType<typeof ensureAcceptanceForReview>
    database.db.transaction((tx) => {
      first = ensureAcceptanceForReview(tx, {
        task: { id: seeded.taskId },
        reviewId: 'r1',
        now: 1,
        newId,
      })
    })
    database.db.transaction((tx) =>
      insertAcceptanceItems(tx, [
        {
          id: 'i1',
          contractId: first.contractId,
          ordinal: 1,
          text: '登录成功',
          status: 'pass',
          evidence: 'src/login.tsx:1',
          source: 'verifier',
          updatedAt: 1,
        },
      ]),
    )
    database.db.transaction((tx) => freezeAcceptanceContract(tx, first.contractId, 5))

    review('r2')
    database.db.transaction((tx) =>
      ensureAcceptanceForReview(tx, {
        task: { id: seeded.taskId },
        reviewId: 'r2',
        now: 6,
        newId,
      }),
    )

    const bundle = getAcceptanceBundle(database.db, seeded.taskId)
    expect(bundle?.contract.version).toBe(2)
    expect(bundle?.items).toEqual([
      expect.objectContaining({
        text: '登录成功',
        status: 'pending',
        evidence: null,
        source: 'verifier',
      }),
    ])
    database.raw.close()
  })
})
