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

function copyMigrationsThrough0008(): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-m9-migrations-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'meta'), { recursive: true })
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> }
  const oldEntries = journal.entries.filter((entry) => entry.idx <= 8)
  for (const entry of oldEntries) {
    copyFileSync(join(migrationsDir, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`))
  }
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: oldEntries }),
  )
  return dir
}

describe('migration 0009', () => {
  it('adds review.diff_json and backfills ws_event.task_id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-m9-'))
    dirs.push(dir)
    const db = openDb(join(dir, 'test.db'))
    try {
      process.env.BATON_MIGRATIONS_DIR = copyMigrationsThrough0008()
      migrateDb(db)
      db.prepare(
        `insert into ws_event (id, type, payload_json, ts) values ('e1', 'task.status', ?, 1)`,
      ).run(
        JSON.stringify({
          taskId: 't1',
          status: 'review',
          previousStatus: 'verifying',
          retryCount: 0,
          attention: 'none',
          updatedAt: 1,
        }),
      )
      db.prepare(
        `insert into ws_event (id, type, payload_json, ts) values ('e2', 'task.status', 'not-json', 2)`,
      ).run()
      db.prepare(
        `insert into ws_event (id, type, payload_json, ts) values ('e3', 'session.event', '{"x":1}', 3)`,
      ).run()

      process.env.BATON_MIGRATIONS_DIR = migrationsDir
      migrateDb(db)

      expect(db.prepare('select id, task_id from ws_event order by ordinal').all()).toEqual([
        { id: 'e1', task_id: 't1' },
        { id: 'e2', task_id: null },
        { id: 'e3', task_id: null },
      ])
      const columns = db.prepare('pragma table_info(review)').all() as Array<{ name: string }>
      expect(columns.map((column) => column.name)).toContain('diff_json')
    } finally {
      db.close()
    }
  })
})
