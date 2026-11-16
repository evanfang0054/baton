import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bootstrap } from '../src/bootstrap.js'
import { loadConfig } from '../src/config.js'

const dirs: string[] = []

afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }))
})

describe('bootstrap', () => {
  it('creates and migrates the database twice without drift', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-boot-'))
    dirs.push(dir)
    const config = loadConfig([], { BATON_DATA_DIR: dir })

    const first = await bootstrap(config)
    const before = first.db
      .prepare('select type, name, sql from sqlite_master order by type, name')
      .all()
    const migrationsBefore = first.db
      .prepare('select count(*) as c from __drizzle_migrations')
      .get()
    await first.app.close()
    first.db.close()

    const second = await bootstrap(config)
    const after = second.db
      .prepare('select type, name, sql from sqlite_master order by type, name')
      .all()
    const migrationsAfter = second.db
      .prepare('select count(*) as c from __drizzle_migrations')
      .get()
    expect(after).toEqual(before)
    expect(migrationsAfter).toEqual(migrationsBefore)
    await second.app.close()
    second.db.close()
  })
})
