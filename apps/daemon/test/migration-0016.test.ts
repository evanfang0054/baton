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
  const dir = mkdtempSync(join(tmpdir(), 'baton-m16-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'meta'), { recursive: true })
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as {
    entries: Array<{ idx: number; tag: string }>
  }
  const entries = journal.entries.filter((entry) => entry.idx <= maxIdx)
  for (const entry of entries) {
    copyFileSync(join(migrationsDir, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`))
  }
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  return dir
}

describe('migration 0016', () => {
  it('drops budget_usd, reopens budget waiting tasks, and relabels budget failures', () => {
    const oldDir = copyThrough(15)
    const raw = openDb(':memory:')
    process.env.BATON_MIGRATIONS_DIR = oldDir
    migrateDb(raw)
    raw
      .prepare('insert into workspace (id, name, rel_path, created_at) values (?, ?, ?, ?)')
      .run('w1', 'demo', 'demo', 1)
    raw
      .prepare(
        `insert into task (id, workspace_id, title, prompt, status, engine, retry_count, dangerously_skip_permissions, budget_usd, waiting_reason, created_at, updated_at)
         values ('t1','w1','t','p','waiting_input','claude-sdk',0,0,2,'budget',1,1)`,
      )
      .run()
    raw
      .prepare(
        `insert into task_failure (id, workspace_id, task_id, session_id, attempt, stage, last_error, retryable, affected_paths_json, summary, created_at)
         values ('f1','w1','t1',null,0,'budget','超出预算',0,null,'超出预算',1)`,
      )
      .run()

    process.env.BATON_MIGRATIONS_DIR = migrationsDir
    migrateDb(raw)

    const columns = raw.prepare('pragma table_info(task)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).not.toContain('budget_usd')
    expect(raw.prepare('select status, waiting_reason from task where id = ?').get('t1')).toEqual({
      status: 'todo',
      waiting_reason: null,
    })
    expect(raw.prepare('select stage from task_failure where id = ?').get('f1')).toEqual({
      stage: 'run',
    })
    raw.close()
  })
})
