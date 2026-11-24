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
  const dir = mkdtempSync(join(tmpdir(), 'baton-m17-'))
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

describe('migration 0017', () => {
  it('keeps delivery annotations and allows workspace-scoped annotations', () => {
    const oldDir = copyThrough(16)
    const raw = openDb(':memory:')
    process.env.BATON_MIGRATIONS_DIR = oldDir
    migrateDb(raw)
    raw
      .prepare('insert into workspace (id, name, rel_path, created_at) values (?, ?, ?, ?)')
      .run('w1', 'demo', 'demo', 1)
    raw
      .prepare('insert into canvas (id, workspace_id, delivery_id) values (?, ?, null)')
      .run('c1', 'w1')
    raw
      .prepare(
        `insert into delivery (id, workspace_id, canvas_id, title, goal, playbook_id, playbook_version, playbook_json, created_at, updated_at)
         values ('d1','w1','c1','t','g','standard',1,'{}',1,1)`,
      )
      .run()
    raw
      .prepare(
        `insert into annotation (id, workspace_id, delivery_id, stage_key, strokes_json, bbox_json, image_path, status, created_at, updated_at)
         values ('a1','w1','d1','design','[]','{}','.baton/deliveries/d1/design/annotations/a1.png','open',1,1)`,
      )
      .run()

    process.env.BATON_MIGRATIONS_DIR = migrationsDir
    migrateDb(raw)

    const columns = raw.prepare('pragma table_info(annotation)').all() as Array<{
      name: string
      notnull: number
    }>
    expect(columns.find((column) => column.name === 'delivery_id')?.notnull).toBe(0)
    expect(columns.find((column) => column.name === 'stage_key')?.notnull).toBe(0)
    expect(raw.prepare('select id, delivery_id, stage_key from annotation').all()).toEqual([
      { id: 'a1', delivery_id: 'd1', stage_key: 'design' },
    ])

    raw
      .prepare(
        `insert into annotation (id, workspace_id, delivery_id, stage_key, strokes_json, bbox_json, image_path, status, created_at, updated_at)
         values ('a2','w1',null,null,'[]','{}','.baton/annotations/w1/a2.png','open',2,2)`,
      )
      .run()
    expect(
      raw.prepare('select delivery_id, stage_key from annotation where id = ?').get('a2'),
    ).toEqual({ delivery_id: null, stage_key: null })
    raw.close()
  })
})
