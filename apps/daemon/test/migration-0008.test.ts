import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDb, openDb } from '../src/db/index.js'

const dirs: string[] = []

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

describe('migration 0008', () => {
  it('adds task.policy_json without changing existing tasks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-m8-'))
    dirs.push(dir)
    const db = openDb(join(dir, 'test.db'))
    try {
      migrateDb(db)
      const columns = db.prepare('PRAGMA table_info(task)').all() as Array<{ name: string }>
      expect(columns.map((column) => column.name)).toContain('policy_json')
      db.prepare(
        `insert into workspace (id, name, rel_path, created_at) values ('w1', 'demo', 'demo', 1)`,
      ).run()
      db.prepare(
        `insert into task (
           id, workspace_id, title, prompt, status, engine, workspace_mode, retry_count,
           dangerously_skip_permissions, created_at, updated_at
         ) values ('t1', 'w1', 'demo', 'x', 'todo', 'fake', 'main', 0, 0, 1, 1)`,
      ).run()
      expect(db.prepare('select policy_json from task where id = ?').get('t1')).toEqual({
        policy_json: null,
      })
    } finally {
      db.close()
    }
  })
})
