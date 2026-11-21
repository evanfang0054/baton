import { describe, expect, it } from 'vitest'
import {
  freezeAcceptanceContract,
  getAcceptanceBundle,
  insertAcceptanceContract,
  insertAcceptanceItems,
  insertAcceptanceRun,
  listAcceptanceSummaries,
  replaceAcceptanceItems,
} from '../src/db/acceptance-repository.js'
import { insertReview } from '../src/db/repositories.js'
import { createTestDb, seedTask } from './helpers/db.js'

function fixture() {
  const database = createTestDb()
  const seeded = seedTask(database.raw)
  database.db.transaction((tx) =>
    insertReview(tx, {
      id: 'r1',
      taskId: seeded.taskId,
      verdict: null,
      verifyExitCode: 0,
      verifyOutput: '',
      diffStat: { filesChanged: 1, insertions: 2, deletions: 0 },
      decidedAt: null,
    }),
  )
  database.db.transaction((tx) => {
    insertAcceptanceContract(tx, {
      id: 'ac1',
      taskId: seeded.taskId,
      version: 1,
      status: 'draft',
      createdBy: 'verifier',
      revision: 0,
      truncated: false,
      createdAt: 1,
      frozenAt: null,
    })
    insertAcceptanceItems(tx, [
      {
        id: 'i1',
        contractId: 'ac1',
        ordinal: 1,
        text: '登录成功',
        status: 'pass',
        evidence: 'src/login.tsx:1',
        source: 'verifier',
        updatedAt: 1,
      },
      {
        id: 'i2',
        contractId: 'ac1',
        ordinal: 2,
        text: '错误提示',
        status: 'fail',
        evidence: null,
        source: 'verifier',
        updatedAt: 1,
      },
    ])
    insertAcceptanceRun(tx, {
      id: 'ar1',
      taskId: seeded.taskId,
      contractId: 'ac1',
      reviewId: 'r1',
      verifierTaskId: null,
      status: 'complete',
      verdict: 'fail',
      summary: '1 条未过',
      createdAt: 2,
      completedAt: 2,
    })
  })
  return { database, seeded }
}

describe('acceptance repository', () => {
  it('round-trips contract/items/run and summarizes', () => {
    const { database, seeded } = fixture()
    const bundle = getAcceptanceBundle(database.db, seeded.taskId)
    expect(bundle?.contract.status).toBe('draft')
    expect(bundle?.items).toHaveLength(2)
    expect(bundle?.run?.verdict).toBe('fail')

    const summaries = listAcceptanceSummaries(database.db, [seeded.taskId])
    expect(summaries.get(seeded.taskId)).toMatchObject({
      counts: { total: 2, pass: 1, fail: 1, pending: 0, waived: 0 },
      verdict: 'fail',
    })
    expect(summaries.get(seeded.taskId)?.topFailures).toEqual([
      { text: '错误提示', evidence: null },
    ])
    database.raw.close()
  })

  it('replaces items, bumps revision and rejects stale revision', () => {
    const { database, seeded } = fixture()
    database.db.transaction((tx) => {
      const result = replaceAcceptanceItems(tx, {
        contractId: 'ac1',
        expectedRevision: 0,
        items: [
          {
            id: 'i1',
            contractId: 'ac1',
            ordinal: 1,
            text: '登录成功',
            status: 'pass',
            evidence: 'src/login.tsx:1',
            source: 'human',
            updatedAt: 3,
          },
        ],
      })
      expect(result).toEqual({ ok: true, revision: 1 })
    })
    expect(getAcceptanceBundle(database.db, seeded.taskId)?.contract.revision).toBe(1)
    expect(getAcceptanceBundle(database.db, seeded.taskId)?.items).toHaveLength(1)

    database.db.transaction((tx) => {
      expect(
        replaceAcceptanceItems(tx, { contractId: 'ac1', expectedRevision: 0, items: [] }),
      ).toMatchObject({ ok: false, code: 'revision_conflict' })
    })
    database.raw.close()
  })

  it('freezes and rejects edits after freeze', () => {
    const { database, seeded } = fixture()
    database.db.transaction((tx) => freezeAcceptanceContract(tx, 'ac1', 10))
    expect(getAcceptanceBundle(database.db, seeded.taskId)?.contract.status).toBe('frozen')
    database.db.transaction((tx) => {
      expect(
        replaceAcceptanceItems(tx, { contractId: 'ac1', expectedRevision: 0, items: [] }),
      ).toMatchObject({ ok: false, code: 'invalid_state' })
    })
    database.raw.close()
  })
})
