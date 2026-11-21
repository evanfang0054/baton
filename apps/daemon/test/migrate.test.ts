import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { EventSchemas, EventType } from '@baton/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { createOrm, migrateDb, openDb } from '../src/db/index.js'
import { createEventStore } from '../src/db/event-store.js'

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
    expect(before.filter((row) => row.type === 'table')).toHaveLength(19)
    expect(
      before
        .filter((row) => row.type === 'index')
        .map((row) => row.name)
        .sort(),
    ).toEqual([
      'acceptance_contract_task_status_idx',
      'acceptance_contract_task_version_idx',
      'acceptance_item_contract_idx',
      'acceptance_item_contract_ordinal_idx',
      'acceptance_run_contract_idx',
      'acceptance_run_review_idx',
      'acceptance_run_task_created_idx',
      'approval_session_request_idx',
      'audit_action_ts_idx',
      'audit_ts_idx',
      'edge_unique_idx',
      'event_ordinal_idx',
      'event_session_seq_idx',
      'node_canvas_idx',
      'notice_workspace_ts_idx',
      'review_task_idx',
      'session_task_idx',
      'supervisor_decision_thread_idx',
      'supervisor_decision_trigger_idx',
      'supervisor_message_thread_idx',
      'supervisor_message_trigger_idx',
      'supervisor_thread_workspace_idx',
      'task_status_idx',
      'task_workspace_idx',
      'workspace_rel_path_unique',
      'ws_event_id_unique',
      'ws_event_task_ordinal_idx',
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
    const insertTask = [
      'insert into task (',
      'id, workspace_id, node_id, title, prompt, status, engine, workspace_mode,',
      'branch, worktree_path, verify_command, retry_count, created_at, updated_at',
      ') values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ].join(' ')
    db.prepare(insertTask).run(
      taskId,
      workspaceId,
      nodeId,
      'demo',
      'demo',
      'todo',
      'fake',
      'main',
      null,
      null,
      null,
      0,
      1,
      1,
    )
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
    expect(columns(db, 'task').find((column) => column.name === 'waiting_reason')?.notnull).toBe(0)
    expect(columns(db, 'session').find((column) => column.name === 'outcome')?.notnull).toBe(0)
    expect(db.prepare('select waiting_reason from task where id = ?').get(taskId)).toEqual({
      waiting_reason: null,
    })
    expect(db.prepare('select outcome from session where id = ?').get(sessionId)).toEqual({
      outcome: null,
    })
    expect(
      db.prepare("select name from sqlite_master where type = 'table' and name = 'ws_event'").get(),
    ).toBeDefined()

    const replay = db.prepare('select id, type, payload_json from ws_event').all() as Array<{
      id: string
      type: string
      payload_json: string
    }>
    expect(replay).toHaveLength(1)
    expect(replay[0]?.id).toBe(eventId)
    expect(replay[0]?.type).toBe('session.event')
    expect(JSON.parse(replay[0]!.payload_json)).toEqual({ sessionId, event: {} })

    // 升级库的 ws_event 序列必须接在回填值之后，否则后续写入会撞 event.ordinal 唯一索引。
    const store = createEventStore(createOrm(db), { now: () => 4, newId: () => randomUUID() })
    const appended = store.appendSessionEvent({
      sessionId,
      seq: 2,
      event: EventSchemas.parse({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'm1',
        delta: 'hi',
      }),
      ts: 4,
    })
    expect(appended.ordinal).toBe(2)
    expect(store.replay(0).rows).toHaveLength(2)
    db.close()
  })

  it('dedupes edges before creating the unique index', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-edge-dedupe-'))
    dirs.push(dir)
    const oldMigrations = join(dir, 'old-migrations')
    mkdirSync(join(oldMigrations, 'meta'), { recursive: true })
    for (const name of [
      '0000_married_hannibal_king.sql',
      '0001_cheerful_xavin.sql',
      '0002_glorious_cardiac.sql',
      '0003_workspace_trust.sql',
      '0004_permissions_and_questions.sql',
    ]) {
      copyFileSync(join(migrationsDir, name), join(oldMigrations, name))
    }
    const fullJournal = JSON.parse(
      readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
    ) as {
      entries: Array<{
        idx: number
        version: string
        when: number
        tag: string
        breakpoints: boolean
      }>
    }
    writeFileSync(
      join(oldMigrations, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: fullJournal.entries.filter((entry) => entry.idx <= 4),
      }),
    )

    process.env.BATON_MIGRATIONS_DIR = oldMigrations
    const db = openDb(join(dir, 'old.db'))
    migrateDb(db)
    db.prepare(
      `insert into workspace (id, name, rel_path, created_at) values ('w1', 'demo', 'demo', 1)`,
    ).run()
    db.prepare(
      `insert into canvas (id, workspace_id, viewport_json) values ('c1', 'w1', '{"x":0,"y":0,"zoom":1}')`,
    ).run()
    for (const id of ['n1', 'n2']) {
      db.prepare(
        `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
         values (?, 'c1', 'text', 0, 0, 320, 200, null, '{"content":"x"}', 1, 1)`,
      ).run(id)
    }
    db.prepare(
      `insert into edge (id, canvas_id, source_id, target_id, type) values
       ('e1', 'c1', 'n1', 'n2', 'context'),
       ('e2', 'c1', 'n1', 'n2', 'context')`,
    ).run()

    process.env.BATON_MIGRATIONS_DIR = migrationsDir
    migrateDb(db)

    const rows = db.prepare(`select id from edge order by id`).all() as Array<{ id: string }>
    expect(rows).toEqual([{ id: 'e1' }])
    expect(
      db
        .prepare(`select name from sqlite_master where type = 'index' and name = 'edge_unique_idx'`)
        .get(),
    ).toEqual({ name: 'edge_unique_idx' })
    expect(columns(db, 'task').find((column) => column.name === 'context_json')?.notnull).toBe(0)
    db.close()
  })
})
