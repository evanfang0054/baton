import { describe, expect, it } from 'vitest'
import {
  freezeAcceptanceContract,
  getAcceptanceBundle,
  getLatestAcceptanceContract,
  insertAcceptanceContract,
} from '../src/db/acceptance-repository.js'
import { insertReview } from '../src/db/repositories.js'
import { ensureAcceptanceForReview } from '../src/runtime/acceptance-service.js'
import { createTestDb, seedTask } from './helpers/db.js'

function fixture() {
  const database = createTestDb()
  const seeded = seedTask(database.raw)
  let counter = 0
  const newId = () => `id-${++counter}`
  return { database, seeded, newId }
}

function addReview(
  database: ReturnType<typeof createTestDb>,
  taskId: string,
  reviewId: string,
): void {
  database.db.transaction((tx) =>
    insertReview(tx, {
      id: reviewId,
      taskId,
      verdict: null,
      verifyExitCode: 1,
      verifyOutput: 'verify failed',
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      decidedAt: null,
    }),
  )
}

describe('ensureAcceptanceForReview', () => {
  it('bumps the version after a failed verify retry leaves a draft contract', () => {
    const { database, seeded, newId } = fixture()

    addReview(database, seeded.taskId, 'review-1')
    const first = database.db.transaction((tx) =>
      ensureAcceptanceForReview(tx, {
        task: { id: seeded.taskId },
        reviewId: 'review-1',
        now: 1,
        newId,
      }),
    )
    expect(first.version).toBe(1)

    // 自动重试没有经过 review，合同仍是 draft；第二次 verify 不能再插入 version=1。
    addReview(database, seeded.taskId, 'review-2')
    const second = database.db.transaction((tx) =>
      ensureAcceptanceForReview(tx, {
        task: { id: seeded.taskId },
        reviewId: 'review-2',
        now: 2,
        newId,
      }),
    )

    expect(second.version).toBe(2)
    const contract = getLatestAcceptanceContract(database.db, seeded.taskId)
    expect(contract).toMatchObject({ version: 2, status: 'draft' })
  })

  it('keeps versioning monotonic after a frozen contract', () => {
    const { database, seeded, newId } = fixture()
    database.db.transaction((tx) =>
      insertAcceptanceContract(tx, {
        id: 'frozen-1',
        taskId: seeded.taskId,
        version: 1,
        status: 'frozen',
        createdBy: 'verifier',
        revision: 0,
        truncated: false,
        createdAt: 1,
        frozenAt: 2,
      }),
    )

    addReview(database, seeded.taskId, 'review-1')
    const result = database.db.transaction((tx) =>
      ensureAcceptanceForReview(tx, {
        task: { id: seeded.taskId },
        reviewId: 'review-1',
        now: 3,
        newId,
      }),
    )

    expect(result.version).toBe(2)
    expect(getAcceptanceBundle(database.db, seeded.taskId)?.contract.status).toBe('draft')
    database.db.transaction((tx) => freezeAcceptanceContract(tx, result.contractId, 4))
    expect(getLatestAcceptanceContract(database.db, seeded.taskId)?.status).toBe('frozen')
  })
})
