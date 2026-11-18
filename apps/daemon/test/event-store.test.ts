import { EventSchemas } from '@baton/protocol'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createEventStore } from '../src/db/event-store.js'
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

  it('truncates large text, tool args and tool results with metadata', () => {
    const database = db()
    const store = createEventStore(database.db, deps)
    const seeded = seedTask(database.raw)
    const text = 'x'.repeat(70 * 1024)
    const args = JSON.stringify({ command: 'y'.repeat(20 * 1024) })
    const result = 'z'.repeat(20 * 1024)

    const events = [
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: text },
      { type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: args },
      { type: 'TOOL_CALL_RESULT', messageId: 'm2', toolCallId: 't1', content: result },
    ] as const

    events.forEach((raw, index) => {
      store.appendSessionEvent({
        sessionId: seeded.sessionId!,
        seq: index + 1,
        event: EventSchemas.parse(raw),
      })
    })

    const rows = database.raw
      .prepare('select type, payload_json from event order by seq')
      .all() as Array<{ type: string; payload_json: string }>
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      const parsed = JSON.parse(row.payload_json) as { _baton?: { truncated?: boolean } }
      expect(parsed._baton?.truncated).toBe(true)
    }
    expect(rows[0]!.payload_json).toContain('…[truncated]')
    expect(Buffer.byteLength(rows[0]!.payload_json)).toBeLessThan(text.length)
    expect(rows[1]!.type).toBe('TOOL_CALL_ARGS')
    expect(rows[2]!.type).toBe('TOOL_CALL_RESULT')
  })
})
