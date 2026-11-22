import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDb, openDb } from '../src/db/index.js'

const dirs: string[] = []
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

function tables(db: ReturnType<typeof openDb>): string[] {
  return (
    db
      .prepare(
        "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' order by name",
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name)
}

describe('migration 0015', () => {
  it('creates delivery/artifact/annotation and nullable columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-m7-'))
    dirs.push(dir)
    const db = openDb(join(dir, 'baton.db'))
    migrateDb(db)

    expect(tables(db)).toEqual(expect.arrayContaining(['delivery', 'artifact', 'annotation']))

    const canvasColumns = db.prepare('pragma table_info(canvas)').all() as Array<{
      name: string
      notnull: number
    }>
    expect(canvasColumns.find((column) => column.name === 'delivery_id')?.notnull).toBe(0)

    const taskColumns = db.prepare('pragma table_info(task)').all() as Array<{
      name: string
      notnull: number
    }>
    expect(taskColumns.find((column) => column.name === 'delivery_id')?.notnull).toBe(0)
    expect(taskColumns.find((column) => column.name === 'stage_key')?.notnull).toBe(0)
    expect(taskColumns.find((column) => column.name === 'annotation_ids_json')?.notnull).toBe(0)

    db.close()
  })
})
