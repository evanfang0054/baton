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

function copyMigrationsThrough(maxIdx: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-m12-migrations-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'meta'), { recursive: true })
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> }
  const oldEntries = journal.entries.filter((entry) => entry.idx <= maxIdx)
  for (const entry of oldEntries) {
    copyFileSync(join(migrationsDir, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`))
  }
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: oldEntries }),
  )
  return dir
}

describe('migration 0012', () => {
  it('adds acceptance tables and a task budget that 0016 later removes', () => {
    const oldDir = copyMigrationsThrough(11)
    const raw = openDb(':memory:')
    process.env.BATON_MIGRATIONS_DIR = oldDir
    migrateDb(raw)
    raw
      .prepare('insert into workspace (id, name, rel_path, created_at) values (?, ?, ?, ?)')
      .run('w1', 'demo', 'demo', 1)
    raw
      .prepare(
        "insert into task (id, workspace_id, title, prompt, status, engine, retry_count, dangerously_skip_permissions, created_at, updated_at) values ('t1','w1','t','p','todo','claude-sdk',0,0,1,1)",
      )
      .run()

    process.env.BATON_MIGRATIONS_DIR = migrationsDir
    migrateDb(raw)

    const columns = (table: string) =>
      (raw.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).map(
        (row) => row.name,
      )
    expect(columns('task')).not.toContain('budget_usd')
    expect(
      raw
        .prepare(
          "select name from sqlite_master where type='table' and name in ('acceptance_contract','acceptance_item','acceptance_run') order by name",
        )
        .all(),
    ).toEqual([
      { name: 'acceptance_contract' },
      { name: 'acceptance_item' },
      { name: 'acceptance_run' },
    ])
    raw.close()
  })
})
