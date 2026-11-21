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

function copyMigrationsThrough0009(): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-m10-migrations-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'meta'), { recursive: true })
  for (const file of readdirSync(migrationsDir)) {
    if (file.endsWith('.sql') && !file.startsWith('0010_')) {
      copyFileSync(join(migrationsDir, file), join(dir, file))
    }
  }
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ tag: string }> }
  journal.entries = journal.entries.filter((entry) => !entry.tag.startsWith('0010_'))
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal))
  for (const file of readdirSync(join(migrationsDir, 'meta'))) {
    if (file.endsWith('.json') && file !== '_journal.json' && !file.startsWith('0010_')) {
      copyFileSync(join(migrationsDir, 'meta', file), join(dir, 'meta', file))
    }
  }
  return dir
}

describe('migration 0010', () => {
  it('adds nullable preliminary fields to existing review rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-m10-'))
    dirs.push(dir)
    const db = openDb(join(dir, 'test.db'))
    try {
      process.env.BATON_MIGRATIONS_DIR = copyMigrationsThrough0009()
      migrateDb(db)
      db.pragma('foreign_keys = OFF')
      db.prepare(
        `insert into review (id, task_id, verdict, verify_exit_code, verify_output, diff_stat_json)
         values ('r1', 't1', null, 0, 'ok', '{"filesChanged":0,"insertions":0,"deletions":0}')`,
      ).run()

      process.env.BATON_MIGRATIONS_DIR = migrationsDir
      migrateDb(db)

      const row = db
        .prepare(
          'select preliminary_verdict, preliminary_reason, preliminary_at from review where id = ?',
        )
        .get('r1') as {
        preliminary_verdict: string | null
        preliminary_reason: string | null
        preliminary_at: number | null
      }
      expect(row).toEqual({
        preliminary_verdict: null,
        preliminary_reason: null,
        preliminary_at: null,
      })
    } finally {
      db.close()
    }
  })
})
