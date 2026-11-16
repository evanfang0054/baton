import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDb, openDb } from '../src/db/index.js'

const dirs: string[] = []

afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }))
})

interface SchemaRow {
  type: string
  name: string
  tbl_name: string
  sql: string | null
}

function schema(db: ReturnType<typeof openDb>): SchemaRow[] {
  return db
    .prepare(
      "select type, name, tbl_name, sql from sqlite_master where name not like 'sqlite_%' and name <> '__drizzle_migrations' order by type, name",
    )
    .all() as SchemaRow[]
}

describe('migrateDb', () => {
  it('is idempotent on a fresh directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-db-'))
    dirs.push(dir)
    const file = join(dir, 'baton.db')

    const db1 = openDb(file)
    migrateDb(db1)
    const before = schema(db1)
    db1.close()

    const db2 = openDb(file)
    migrateDb(db2)
    expect(schema(db2)).toEqual(before)
    expect(before.filter((row) => row.type === 'table')).toHaveLength(11)
    expect(
      before
        .filter((row) => row.type === 'index')
        .map((row) => row.name)
        .sort(),
    ).toEqual([
      'audit_ts_idx',
      'event_session_seq_idx',
      'node_canvas_idx',
      'task_status_idx',
      'workspace_rel_path_unique',
    ])
    db2.close()
  })
})
