import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDb, openDb } from '../src/db/index.js'

const dirs: string[] = []

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

describe('migration 0006', () => {
  it('adds task.origin_json and the supervisor tables/indexes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-m6-'))
    dirs.push(dir)
    const db = openDb(join(dir, 'test.db'))
    try {
      migrateDb(db)

      const columns = db.prepare('PRAGMA table_info(task)').all() as Array<{ name: string }>
      expect(columns.map((column) => column.name)).toContain('origin_json')

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>
      expect(tables.map((row) => row.name)).toEqual(
        expect.arrayContaining(['supervisor_thread', 'supervisor_message', 'supervisor_decision']),
      )

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index'")
        .all() as Array<{ name: string }>
      expect(indexes.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          'supervisor_message_trigger_idx',
          'supervisor_message_thread_idx',
          'supervisor_decision_trigger_idx',
          'supervisor_decision_thread_idx',
          'supervisor_thread_workspace_idx',
        ]),
      )
    } finally {
      db.close()
    }
  })

  it('keeps existing tasks with a null origin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-m6-old-'))
    dirs.push(dir)
    const db = openDb(join(dir, 'test.db'))
    try {
      migrateDb(db)
      db.prepare(
        `insert into workspace (id, name, rel_path, created_at) values ('w1', 'demo', 'demo', 1)`,
      ).run()
      db.prepare(
        `insert into task (
           id, workspace_id, title, prompt, status, engine, workspace_mode, retry_count,
           dangerously_skip_permissions, created_at, updated_at
         ) values ('t1', 'w1', 'demo', 'x', 'todo', 'fake', 'main', 0, 0, 1, 1)`,
      ).run()

      const row = db.prepare('select origin_json from task where id = ?').get('t1') as {
        origin_json: string | null
      }
      expect(row.origin_json).toBeNull()
    } finally {
      db.close()
    }
  })
})
