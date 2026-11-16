import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDb, openDb } from '../src/db/index.js'

const dirs: string[] = []

afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }))
})

function tables(db: ReturnType<typeof openDb>): string[] {
  return db
    .prepare("select name from sqlite_master where type='table' order by name")
    .all()
    .map((r) => (r as { name: string }).name)
}

describe('migrateDb', () => {
  it('is idempotent on a fresh directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-db-'))
    dirs.push(dir)
    const file = join(dir, 'baton.db')

    const db1 = openDb(file)
    migrateDb(db1)
    const before = tables(db1)
    db1.close()

    const db2 = openDb(file)
    migrateDb(db2)
    expect(tables(db2)).toEqual(before)
    expect(before).toContain('task')
    db2.close()
  })
})
