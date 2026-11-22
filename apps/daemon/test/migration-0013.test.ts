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

function copyThrough(maxIdx: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-m13-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'meta'), { recursive: true })
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> }
  const entries = journal.entries.filter((entry) => entry.idx <= maxIdx)
  for (const entry of entries) {
    copyFileSync(join(migrationsDir, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`))
  }
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  return dir
}

describe('migration 0013', () => {
  it('adds the supervisor action and task failure ledgers', () => {
    const oldDir = copyThrough(12)
    const raw = openDb(':memory:')
    process.env.BATON_MIGRATIONS_DIR = oldDir
    migrateDb(raw)
    raw
      .prepare('insert into workspace (id, name, rel_path, created_at) values (?, ?, ?, ?)')
      .run('w1', 'demo', 'demo', 1)
    raw
      .prepare(
        `insert into task (id, workspace_id, title, prompt, status, engine, retry_count,
          dangerously_skip_permissions, created_at, updated_at)
         values ('t1','w1','t','p','failed','claude-sdk',0,0,1,1)`,
      )
      .run()
    raw
      .prepare('update task set origin_json = ? where id = ?')
      .run(JSON.stringify({ source: 'canvas', policyVersion: 'p1' }), 't1')

    process.env.BATON_MIGRATIONS_DIR = migrationsDir
    migrateDb(raw)

    const tables = raw
      .prepare(
        `select name from sqlite_master where type='table'
         and name in ('supervisor_action','task_failure') order by name`,
      )
      .all()
    expect(tables).toEqual([{ name: 'supervisor_action' }, { name: 'task_failure' }])
    const indexes = raw
      .prepare(
        `select name from sqlite_master where type='index'
         and name in ('supervisor_action_dedupe_idx','supervisor_action_status_idx',
           'task_failure_task_idx')
         order by name`,
      )
      .all()
    expect(indexes).toEqual([
      { name: 'supervisor_action_dedupe_idx' },
      { name: 'supervisor_action_status_idx' },
      { name: 'task_failure_task_idx' },
    ])
    expect(raw.prepare("select origin_json from task where id='t1'").get()).toEqual({
      origin_json: JSON.stringify({ source: 'canvas', policyVersion: 'p1' }),
    })
    raw.close()
  })
})
