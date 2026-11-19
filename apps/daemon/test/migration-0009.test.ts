import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
  for (const file of readdirSync(migrationsDir)) {
    if (file.endsWith('.sql') && !file.startsWith('0009_')) {
      copyFileSync(join(migrationsDir, file), join(dir, file))
    }
  }
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ tag: string }> }
  journal.entries = journal.entries.filter((entry) => !entry.tag.startsWith('0009_'))
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal))
  for (const file of readdirSync(join(migrationsDir, 'meta'))) {
    if (file.endsWith('.json') && file !== '_journal.json' && !file.startsWith('0009_')) {
      copyFileSync(join(migrationsDir, 'meta', file), join(dir, 'meta', file))
    }
  }
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
