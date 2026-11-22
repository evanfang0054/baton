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
  const dir = mkdtempSync(join(tmpdir(), 'baton-m14-'))
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

describe('migration 0014', () => {
  it('moves legacy fake engine rows to claude-sdk', () => {
    const oldDir = copyThrough(13)
    const raw = openDb(':memory:')
    process.env.BATON_MIGRATIONS_DIR = oldDir
    migrateDb(raw)
    raw
      .prepare('insert into workspace (id, name, rel_path, created_at) values (?, ?, ?, ?)')
      .run('w1', 'demo', 'demo', 1)
    raw
      .prepare('insert into canvas (id, workspace_id, viewport_json) values (?, ?, ?)')
      .run('c1', 'w1', '{}')
    raw
      .prepare(
        `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
         values ('n1', 'c1', 'agent', 0, 0, 320, 200, null, ?, 1, 1)`,
      )
      .run(JSON.stringify({ title: '旧 Agent', engine: 'fake', taskId: null }))
    raw
      .prepare(
        `insert into task (id, workspace_id, title, prompt, status, engine, retry_count,
          dangerously_skip_permissions, created_at, updated_at)
         values ('t1','w1','t','p','todo','fake',0,0,1,1)`,
      )
      .run()
    raw
      .prepare(
        `insert into session (id, task_id, adapter, engine_session_id, status, started_at)
         values ('s1','t1','fake',null,'ended',1)`,
      )
      .run()

    process.env.BATON_MIGRATIONS_DIR = migrationsDir
    migrateDb(raw)

    expect(raw.prepare("select engine from task where id='t1'").get()).toEqual({
      engine: 'claude-sdk',
    })
    expect(raw.prepare("select adapter from session where id='s1'").get()).toEqual({
      adapter: 'claude-sdk',
    })
    const node = raw.prepare("select data_json from node where id='n1'").get() as {
      data_json: string
    }
    expect(JSON.parse(node.data_json)).toMatchObject({ engine: 'claude-sdk' })
    raw.close()
  })
})
