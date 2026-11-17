import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDb, openDb } from '../src/db/index.js'

const dirs: string[] = []
const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url))

afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }))
  delete process.env.BATON_MIGRATIONS_DIR
})

interface SchemaRow {
  type: string
  name: string
  tbl_name: string
  sql: string | null
}

interface ColumnRow {
  name: string
  notnull: number
}

function schema(db: ReturnType<typeof openDb>): SchemaRow[] {
  return db
    .prepare(
      "select type, name, tbl_name, sql from sqlite_master where name not like 'sqlite_%' and name <> '__drizzle_migrations' order by type, name",
    )
    .all() as SchemaRow[]
}

function columns(db: ReturnType<typeof openDb>, table: string): ColumnRow[] {
  return db.prepare(`pragma table_info(${table})`).all() as ColumnRow[]
}

describe('migrateDb', () => {
  it('is idempotent on a fresh directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-db-'))
    dirs.push(dir)
    const file = join(dir, 'baton.db')

    const db1 = openDb(file)
    migrateDb(db1)
    const before = schema(db1)
    db1.close()

    const db2 = openDb(file)
    migrateDb(db2)
    expect(schema(db2)).toEqual(before)
    expect(before.filter((row) => row.type === 'table')).toHaveLength(12)
    expect(
      before
        .filter((row) => row.type === 'index')
        .map((row) => row.name)
        .sort(),
    ).toEqual([
      'approval_session_request_idx',
      'audit_ts_idx',
      'event_ordinal_idx',
      'event_session_seq_idx',
      'node_canvas_idx',
      'task_status_idx',
      'workspace_rel_path_unique',
      'ws_event_id_unique',
      'ws_event_ts_idx',
    ])
    expect(columns(db2, 'review').find((column) => column.name === 'verdict')?.notnull).toBe(0)
    expect(columns(db2, 'event').find((column) => column.name === 'ordinal')?.notnull).toBe(1)
    db2.close()
  })

  it('upgrades a 0000 database and preserves events', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-upgrade-'))
    dirs.push(dir)
    const oldMigrations = join(dir, 'old-migrations')
    mkdirSync(join(oldMigrations, 'meta'), { recursive: true })
    copyFileSync(
      join(migrationsDir, '0000_married_hannibal_king.sql'),
      join(oldMigrations, '0000_married_hannibal_king.sql'),
    )
    const db = openDb(join(dir, 'old.db'))
    const fullJournal = JSON.parse(
      readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ when: number }> }
    const firstWhen = fullJournal.entries[0]!.when
    writeFileSync(
      join(oldMigrations, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [
          {
            idx: 0,
            version: '6',
            when: firstWhen,
            tag: '0000_married_hannibal_king',
            breakpoints: true,
          },
        ],
      }),
    )
    process.env.BATON_MIGRATIONS_DIR = oldMigrations
    migrateDb(db)

    const workspaceId = randomUUID()
    const canvasId = randomUUID()
    const nodeId = randomUUID()
    const taskId = randomUUID()
    const sessionId = randomUUID()
    const eventId = randomUUID()
    db.prepare('insert into workspace (id, name, rel_path, created_at) values (?, ?, ?, ?)').run(
      workspaceId,
      'demo',
      'demo',
      1,
    )
    db.prepare('insert into canvas (id, workspace_id, viewport_json) values (?, ?, ?)').run(
      canvasId,
      workspaceId,
      '{}',
    )
    db.prepare(
      `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
       values (?, ?, 'agent', 0, 0, 320, 200, null, '{}', 1, 1)`,
    ).run(nodeId, canvasId)
    db.prepare(
      `insert into task (id, workspace_id, node_id, title, prompt, status, engine, workspace_mode, branch, worktree_path, verify_command, retry_count, created_at, updated_at)
       values (?, ?, ?, 'demo', 'demo', 'todo', 'fake', 'main', null, null, null, 0, 1, 1)`,
    ).run(taskId, workspaceId, nodeId)
    db.prepare(
      `insert into session (id, task_id, adapter, engine_session_id, status, started_at, ended_at)
       values (?, ?, 'fake', null, 'ended', 1, 2)`,
    ).run(sessionId, taskId)
    db.prepare(
      'insert into event (id, session_id, seq, type, payload_json, ts) values (?, ?, ?, ?, ?, ?)',
    ).run(eventId, sessionId, 1, 'RUN_STARTED', '{}', 1)
    db.prepare(
      `insert into review (id, task_id, verdict, verify_exit_code, verify_output, diff_stat_json, decided_at)
       values (?, ?, 'approved', 0, 'ok', '{"filesChanged":0,"insertions":0,"deletions":0}', 2)`,
    ).run(randomUUID(), taskId)

    process.env.BATON_MIGRATIONS_DIR = migrationsDir
    migrateDb(db)

    const rows = db.prepare('select id, ordinal from event').all() as Array<{
      id: string
      ordinal: number
    }>
    expect(rows).toEqual([{ id: eventId, ordinal: 1 }])
    expect(columns(db, 'event').find((column) => column.name === 'ordinal')?.notnull).toBe(1)
    expect(columns(db, 'review').find((column) => column.name === 'verdict')?.notnull).toBe(0)
    expect(
      db.prepare("select name from sqlite_master where type = 'table' and name = 'ws_event'").get(),
    ).toBeDefined()
    db.close()
  })
})
