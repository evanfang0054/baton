import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDb, openDb } from '../src/db/index.js'

const dirs: string[] = []
const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url))

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  delete process.env.BATON_MIGRATIONS_DIR
})

interface ColumnRow {
  name: string
}

describe('migration 0007', () => {
  it('creates setting, notice.workspace_id and the query indexes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-m7-'))
    dirs.push(dir)
    const db = openDb(join(dir, 'test.db'))
    try {
      migrateDb(db)
      const tables = db
        .prepare("select name from sqlite_master where type='table'")
        .all() as Array<{ name: string }>
      expect(tables.map((row) => row.name)).toContain('setting')

      const columns = db.prepare('pragma table_info(notice)').all() as ColumnRow[]
      expect(columns.map((row) => row.name)).toContain('workspace_id')

      const indexes = db
        .prepare("select name from sqlite_master where type='index'")
        .all() as Array<{ name: string }>
      expect(indexes.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          'notice_workspace_ts_idx',
          'audit_action_ts_idx',
          'task_workspace_idx',
          'session_task_idx',
          'review_task_idx',
        ]),
      )
    } finally {
      db.close()
    }
  })

  it('keeps existing notices with a null workspace after upgrade', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-m7-old-'))
    dirs.push(dir)
    const oldMigrations = join(dir, 'old-migrations')
    mkdirSync(join(oldMigrations, 'meta'), { recursive: true })
    const journal = JSON.parse(
      readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> }
    const oldEntries = journal.entries.filter((entry) => entry.idx <= 6)
    for (const entry of oldEntries) {
      copyFileSync(join(migrationsDir, `${entry.tag}.sql`), join(oldMigrations, `${entry.tag}.sql`))
    }
    writeFileSync(
      join(oldMigrations, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: oldEntries }),
    )

    const db = openDb(join(dir, 'old.db'))
    try {
      process.env.BATON_MIGRATIONS_DIR = oldMigrations
      migrateDb(db)
      db.prepare(
        `insert into workspace (id, name, rel_path, created_at) values ('w-old', 'old', 'old', 1)`,
      ).run()
      db.prepare(
        `insert into task (
           id, workspace_id, title, prompt, status, engine, workspace_mode, retry_count,
           dangerously_skip_permissions, created_at, updated_at
         ) values ('t-old', 'w-old', 'old', 'x', 'todo', 'claude-sdk', 'main', 0, 0, 1, 1)`,
      ).run()
      db.prepare(
        `insert into session (id, task_id, adapter, status, started_at)
         values ('s-old', 't-old', 'claude-sdk', 'ended', 1)`,
      ).run()
      db.prepare(`insert into review (id, task_id) values ('r-old', 't-old')`).run()
      db.prepare(
        `insert into notice (id, ts, kind, payload_json, read_at) values (?, ?, ?, ?, ?)`,
      ).run('n-old', 1, 'digest', '{}', null)

      delete process.env.BATON_MIGRATIONS_DIR
      migrateDb(db)
      const row = db.prepare('select workspace_id from notice where id = ?').get('n-old') as {
        workspace_id: string | null
      }
      expect(row.workspace_id).toBeNull()
      expect(db.prepare('select count(*) as count from task').get()).toEqual({ count: 1 })
      expect(db.prepare('select count(*) as count from session').get()).toEqual({ count: 1 })
      expect(db.prepare('select count(*) as count from review').get()).toEqual({ count: 1 })
    } finally {
      db.close()
    }
  })
})
