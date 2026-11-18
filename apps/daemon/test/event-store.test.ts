import { EventSchemas } from '@baton/protocol'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createEventStore } from '../src/db/event-store.js'
import { buildWsFrame } from '../src/ws/hub.js'
import { createTestDb, seedTask, type TestDb } from './helpers/db.js'

const dbs: TestDb[] = []
const deps = { now: () => 1, newId: () => randomUUID() }

function db(): TestDb {
  const created = createTestDb()
  dbs.push(created)
  return created
}

function fakeEvent(delta = 'hi') {
  return EventSchemas.parse({
    type: 'TEXT_MESSAGE_CONTENT',
    messageId: `m-${delta}`,
    delta,
  })
}

afterEach(() => {
  dbs.splice(0).forEach((entry) => entry.raw.close())
})

describe('event store', () => {
  it('allocates a global ordinal across sessions and keeps per-session seq', () => {
    const database = db()
    const store = createEventStore(database.db, deps)
    const a = seedTask(database.raw, { now: 1 })
    const b = seedTask(database.raw, { now: 2 })
    const one = store.appendSessionEvent({
      sessionId: a.sessionId!,
      seq: 1,
      event: fakeEvent('one'),
      ts: 1,
    })
    const two = store.appendSessionEvent({
      sessionId: b.sessionId!,
      seq: 1,
      event: fakeEvent('two'),
      ts: 2,
    })
    expect(two.ordinal).toBeGreaterThan(one.ordinal)
    expect(store.replay(0).rows.map((row) => row.ordinal)).toEqual([one.ordinal, two.ordinal])
    expect(store.maxOrdinal()).toBe(two.ordinal)
  })

  it('writes the same ordinal into event and ws_event', () => {
    const database = db()
    const store = createEventStore(database.db, deps)
    const seeded = seedTask(database.raw)
    const appended = store.appendSessionEvent({
      sessionId: seeded.sessionId!,
      seq: 1,
      event: fakeEvent('same'),
      ts: 5,
    })
    const eventRow = database.raw
      .prepare('select ordinal, seq, type from event where session_id = ?')
      .get(seeded.sessionId!) as { ordinal: number; seq: number; type: string }
    const wsRow = database.raw
      .prepare('select ordinal, type from ws_event where ordinal = ?')
      .get(appended.ordinal) as { ordinal: number; type: string }
    expect(eventRow).toEqual({ ordinal: appended.ordinal, seq: 1, type: 'TEXT_MESSAGE_CONTENT' })
    expect(wsRow).toEqual({ ordinal: appended.ordinal, type: 'session.event' })
    expect(appended.payload).toMatchObject({
      sessionId: seeded.sessionId,
      seq: 1,
      event: { type: 'TEXT_MESSAGE_CONTENT' },
    })
  })

  it('reuses the payload JSON when building the ws frame', () => {
    const database = db()
    const store = createEventStore(database.db, deps)
    const seeded = seedTask(database.raw)
    const appended = store.appendSessionEvent({
      sessionId: seeded.sessionId!,
      seq: 1,
      event: fakeEvent('frame'),
      ts: 9,
    })
    expect(JSON.parse(appended.payloadJson)).toEqual(appended.payload)
    expect(JSON.parse(buildWsFrame(appended))).toEqual({
      v: 1,
      id: appended.id,
      type: appended.type,
      ts: appended.ts,
      seq: appended.ordinal,
      payload: appended.payload,
    })
  })

  it('replays after the cursor in ascending order with hasMore', () => {
    const database = db()
    const store = createEventStore(database.db, deps)
    const seeded = seedTask(database.raw)
    const first = database.db.transaction((tx) =>
      store.appendTaskStatus(tx, {
        taskId: seeded.taskId,
        status: 'queued',
        previousStatus: 'todo',
        retryCount: 0,
        updatedAt: 1,
      }),
    )
    const second = database.db.transaction((tx) =>
      store.appendTaskStatus(tx, {
        taskId: seeded.taskId,
        status: 'running',
        previousStatus: 'queued',
        retryCount: 0,
        updatedAt: 2,
      }),
    )

    const page = store.replay(0, 1)
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0]!.ordinal).toBe(first.ordinal)
    expect(page.rows[0]!.type).toBe('task.status')
    expect(page.hasMore).toBe(true)

    const rest = store.replay(first.ordinal, 10)
    expect(rest.rows).toHaveLength(1)
    expect(rest.rows[0]!.ordinal).toBe(second.ordinal)
    expect(rest.hasMore).toBe(false)
  })

  it('reports max ordinal and rolls back a duplicate session seq', () => {
    const database = db()
    const store = createEventStore(database.db, deps)
    const seeded = seedTask(database.raw)
    const first = store.appendSessionEvent({
      sessionId: seeded.sessionId!,
      seq: 1,
      event: fakeEvent('first'),
    })
    expect(store.maxOrdinal()).toBe(first.ordinal)
    expect(() =>
      store.appendSessionEvent({
        sessionId: seeded.sessionId!,
        seq: 1,
        event: fakeEvent('duplicate'),
      }),
    ).toThrow()
    expect(store.maxOrdinal()).toBe(first.ordinal)
  })

  it('appends approval and verify payloads', () => {
    const database = db()
    const store = createEventStore(database.db, deps)
    const seeded = seedTask(database.raw)
    const approval = database.db.transaction((tx) =>
      store.appendApprovalRequest(tx, {
        approvalId: 'a1',
        sessionId: seeded.sessionId!,
        request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' },
        ts: 1,
      }),
    )
    const verify = database.db.transaction((tx) =>
      store.appendVerifyResult(tx, {
        taskId: seeded.taskId,
        reviewId: 'r1',
        exitCode: 0,
        output: 'ok',
        diffStat: { filesChanged: 1, insertions: 2, deletions: 3 },
        durationMs: 10,
        ts: 2,
      }),
    )
    const rows = store.replay(0).rows
    expect(rows.map((row) => row.type)).toEqual(['approval.request', 'verify.result'])
    expect(rows[0]!.ordinal).toBe(approval.ordinal)
    expect(rows[1]!.ordinal).toBe(verify.ordinal)
    expect(rows[0]!.payload).toMatchObject({ approvalId: 'a1', sessionId: seeded.sessionId })
    expect(rows[1]!.payload).toMatchObject({ reviewId: 'r1', exitCode: 0, durationMs: 10 })
  })
})
