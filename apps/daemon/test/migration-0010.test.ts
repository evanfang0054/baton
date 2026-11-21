import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Review } from '@baton/protocol'
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
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> }
  const oldEntries = journal.entries.filter((entry) => entry.idx <= 9)
  for (const entry of oldEntries) {
    copyFileSync(join(migrationsDir, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`))
  }
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: oldEntries }),
  )
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
          `select id, task_id, verdict, verify_exit_code, verify_output, diff_stat_json,
                  decided_at, preliminary_verdict, preliminary_reason, preliminary_at
           from review where id = ?`,
        )
        .get('r1') as {
        id: string
        task_id: string
        verdict: string | null
        verify_exit_code: number
        verify_output: string
        diff_stat_json: string
        decided_at: number | null
        preliminary_verdict: string | null
        preliminary_reason: string | null
        preliminary_at: number | null
      }
      expect(row).toMatchObject({
        preliminary_verdict: null,
        preliminary_reason: null,
        preliminary_at: null,
      })
      expect(
        Review.parse({
          id: row.id,
          taskId: row.task_id,
          verdict: row.verdict,
          verifyExitCode: row.verify_exit_code,
          verifyOutput: row.verify_output,
          diffStat: JSON.parse(row.diff_stat_json) as unknown,
          decidedAt: row.decided_at,
          preliminaryVerdict: row.preliminary_verdict,
          preliminaryReason: row.preliminary_reason,
          preliminaryAt: row.preliminary_at,
        }),
      ).toMatchObject({
        preliminaryVerdict: null,
        preliminaryReason: null,
        preliminaryAt: null,
      })
    } finally {
      db.close()
    }
  })
})
