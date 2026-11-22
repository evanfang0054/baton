import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDb, openDb } from '../src/db/index.js'
import {
  appendTaskContextInjection,
  getTaskDetail,
  insertSession,
  insertTask,
  listQueuedTasksByEnqueuedAt,
  listSessionsByTask,
  updateSessionUsage,
} from '../src/db/repositories.js'
import { createTestDb, seedTask } from './helpers/db.js'

const dirs: string[] = []
const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url))

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  delete process.env.BATON_MIGRATIONS_DIR
})

function copyMigrationsThrough0010(): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-m11-migrations-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'meta'), { recursive: true })
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> }
  const oldEntries = journal.entries.filter((entry) => entry.idx <= 10)
  for (const entry of oldEntries) {
    copyFileSync(join(migrationsDir, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`))
  }
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: oldEntries }),
  )
  return dir
}

function queuedTask(
  id: string,
  workspaceId: string,
  nodeId: string,
  enqueuedAt: number | null,
): Parameters<typeof insertTask>[1] {
  return {
    id,
    workspaceId,
    nodeId,
    title: id,
    prompt: '',
    status: 'queued',
    waitingReason: null,
    engine: 'claude-sdk',
    workspaceMode: 'main',
    branch: null,
    worktreePath: null,
    verifyCommand: null,
    retryCount: 0,
    dangerouslySkipPermissions: false,
    createdAt: 1,
    updatedAt: 100,
    enqueuedAt,
  }
}

describe('migration 0011', () => {
  it('adds enqueued_at and session usage columns', () => {
    const database = createTestDb()
    const columns = (table: string) =>
      (database.raw.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).map(
        (row) => row.name,
      )
    expect(columns('task')).toContain('enqueued_at')
    expect(columns('session')).toEqual(expect.arrayContaining(['cost_usd', 'turns']))
    database.raw.close()
  })

  it('appends injection and preserves initial snapshot', () => {
    const database = createTestDb()
    const seeded = seedTask(database.raw, { withSession: false })
    const initial = {
      included: [{ id: 'old', type: 'text', title: '旧上下文', depth: 0, chars: 1 }],
      dropped: [],
      truncated: false,
      redactedPaths: [],
      relations: [],
      relationsTruncated: false,
      injections: [],
    }
    database.raw
      .prepare('update task set context_json = ? where id = ?')
      .run(JSON.stringify(initial), seeded.taskId)
    database.db.transaction((tx) =>
      appendTaskContextInjection(tx, seeded.taskId, {
        seq: 1,
        at: 2,
        source: 'user',
        note: null,
        requestId: null,
        nodeIds: ['n1'],
        included: [],
        dropped: [],
        truncated: false,
        relations: [],
        relationsTruncated: false,
        chars: 1,
      }),
    )
    const detail = getTaskDetail(database.db, seeded.taskId)
    expect(detail?.task.context?.included.map((item) => item.id)).toEqual(['old'])
    expect(detail?.task.context?.injections.map((item) => item.seq)).toEqual([1])
    database.raw.close()
  })

  it('orders queued tasks by enqueued_at with updated_at fallback', () => {
    const database = createTestDb()
    const seeded = seedTask(database.raw, { withSession: false })
    database.db.transaction((tx) => {
      insertTask(tx, queuedTask('q2', seeded.workspaceId, seeded.nodeId, 20))
      insertTask(tx, queuedTask('q1', seeded.workspaceId, seeded.nodeId, 10))
      insertTask(tx, queuedTask('q0', seeded.workspaceId, seeded.nodeId, null))
    })
    expect(listQueuedTasksByEnqueuedAt(database.db).map((item) => item.id)).toEqual([
      'q1',
      'q2',
      'q0',
    ])
    database.raw.close()
  })

  it('persists session usage', () => {
    const database = createTestDb()
    const seeded = seedTask(database.raw, { withSession: false })
    database.db.transaction((tx) =>
      insertSession(tx, {
        id: 's1',
        taskId: seeded.taskId,
        adapter: 'claude-sdk',
        engineSessionId: null,
        status: 'running',
        outcome: null,
        startedAt: 1,
        endedAt: null,
      }),
    )
    database.db.transaction((tx) => updateSessionUsage(tx, 's1', { costUsd: 0.42, turns: 3 }))
    database.db.transaction((tx) => updateSessionUsage(tx, 's1', {}))
    expect(listSessionsByTask(database.db, seeded.taskId)[0]).toMatchObject({
      costUsd: 0.42,
      turns: 3,
    })
    database.raw.close()
  })

  it('upgrades 0010 → 0011 and backfills queued enqueued_at', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-m11-'))
    dirs.push(dir)
    const db = openDb(join(dir, 'test.db'))
    try {
      process.env.BATON_MIGRATIONS_DIR = copyMigrationsThrough0010()
      migrateDb(db)
      db.prepare('insert into workspace (id, name, rel_path, created_at) values (?, ?, ?, ?)').run(
        'w1',
        'demo',
        'demo',
        1,
      )
      const insertTask = db.prepare(
        `insert into task (
           id, workspace_id, title, prompt, status, engine, workspace_mode,
           retry_count, created_at, updated_at
         ) values (?, ?, ?, ?, ?, 'claude-sdk', 'main', 0, 1, ?)`,
      )
      insertTask.run('q1', 'w1', 'queued', '', 'queued', 123)
      insertTask.run('t1', 'w1', 'todo', '', 'todo', 456)
      db.prepare(
        `insert into session (id, task_id, adapter, status, started_at)
         values ('s1', 'q1', 'claude-sdk', 'running', 1)`,
      ).run()

      process.env.BATON_MIGRATIONS_DIR = migrationsDir
      migrateDb(db)

      expect(db.prepare('select enqueued_at from task where id = ?').get('q1')).toEqual({
        enqueued_at: 123,
      })
      expect(db.prepare('select enqueued_at from task where id = ?').get('t1')).toEqual({
        enqueued_at: null,
      })
      expect(db.prepare('select cost_usd, turns from session where id = ?').get('s1')).toEqual({
        cost_usd: null,
        turns: null,
      })
    } finally {
      db.close()
    }
  })
})
