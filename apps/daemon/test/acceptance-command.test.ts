import { describe, expect, it } from 'vitest'
import {
  freezeAcceptanceContract,
  getAcceptanceBundle,
  insertAcceptanceContract,
  insertAcceptanceItems,
  insertAcceptanceRun,
} from '../src/db/acceptance-repository.js'
import { createEventStore } from '../src/db/event-store.js'
import { insertReview, listAudit } from '../src/db/repositories.js'
import { handleAcceptanceUpdate } from '../src/runtime/acceptance-command.js'
import { createTestDb, seedTask } from './helpers/db.js'

function fixture(taskStatus: 'review' | 'todo' = 'review') {
  const database = createTestDb()
  const seeded = seedTask(database.raw, { taskStatus })
  let counter = 0
  const newId = () => `id-${++counter}`
  const now = () => 7
  const eventStore = createEventStore(database.db, { now, newId })

  if (taskStatus === 'review') {
    database.db.transaction((tx) =>
      insertReview(tx, {
        id: 'r1',
        taskId: seeded.taskId,
        verdict: null,
        verifyExitCode: 0,
        verifyOutput: '',
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
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
          text: '旧条目',
          status: 'pending',
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
        verdict: 'incomplete',
        summary: null,
        createdAt: 2,
        completedAt: 2,
      })
    })
  }
  return { database, seeded, newId, now, eventStore }
}

describe('acceptance.update command', () => {
  it('replaces items, bumps revision, audits and emits', () => {
    const { database, seeded, newId, now, eventStore } = fixture()
    const result = handleAcceptanceUpdate(
      { db: database.db, eventStore, now, newId },
      {
        taskId: seeded.taskId,
        contractId: 'ac1',
        expectedRevision: 0,
        items: [{ text: '登录成功', status: 'pass', evidence: 'src/login.tsx:1' }],
      },
    )
    expect(result).toMatchObject({ ok: true, ack: { revision: 1 } })
    expect(getAcceptanceBundle(database.db, seeded.taskId)?.items).toEqual([
      expect.objectContaining({ text: '登录成功', status: 'pass', source: 'human' }),
    ])
    expect(
      listAudit(database.db, { actionPrefix: 'task.acceptance.update', limit: 10 }),
    ).toHaveLength(1)
    expect(eventStore.replay(0).rows.some((event) => event.type === 'acceptance.updated')).toBe(
      true,
    )
    database.raw.close()
  })

  it('returns revision_conflict on stale revision', () => {
    const { database, seeded, newId, now, eventStore } = fixture()
    handleAcceptanceUpdate(
      { db: database.db, eventStore, now, newId },
      {
        taskId: seeded.taskId,
        contractId: 'ac1',
        expectedRevision: 0,
        items: [{ text: '新条目', status: 'pending' }],
      },
    )
    const stale = handleAcceptanceUpdate(
      { db: database.db, eventStore, now, newId },
      {
        taskId: seeded.taskId,
        contractId: 'ac1',
        expectedRevision: 0,
        items: [{ text: '再来一次', status: 'pending' }],
      },
    )
    expect(stale).toMatchObject({ ok: false, error: { code: 'revision_conflict' } })
    database.raw.close()
  })

  it('rejects non-review tasks and frozen contracts', () => {
    const todo = fixture('todo')
    expect(
      handleAcceptanceUpdate(
        { db: todo.database.db, eventStore: todo.eventStore, now: todo.now, newId: todo.newId },
        { taskId: todo.seeded.taskId, contractId: 'ac1', expectedRevision: 0, items: [] },
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid_state' } })
    todo.database.raw.close()

    const frozen = fixture()
    frozen.database.db.transaction((tx) => freezeAcceptanceContract(tx, 'ac1', 9))
    expect(
      handleAcceptanceUpdate(
        {
          db: frozen.database.db,
          eventStore: frozen.eventStore,
          now: frozen.now,
          newId: frozen.newId,
        },
        { taskId: frozen.seeded.taskId, contractId: 'ac1', expectedRevision: 0, items: [] },
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid_state' } })
    frozen.database.raw.close()
  })
})
