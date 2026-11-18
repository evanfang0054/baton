import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from './schema.js'
import type { Db } from './types.js'

export function openDb(file: string): Database.Database {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  return db
}

export function createOrm(db: Database.Database): Db {
  return drizzle(db, { schema })
}

function migrationCandidates(): string[] {
  const fromEnv = process.env.BATON_MIGRATIONS_DIR
  return [
    ...(fromEnv ? [fromEnv] : []),
    fileURLToPath(new URL('./migrations', import.meta.url)),
    fileURLToPath(new URL('../../migrations', import.meta.url)),
    join(process.cwd(), 'apps/daemon/migrations'),
  ]
}

function resolveMigrationsDir(): string {
  const dir = migrationCandidates().find((candidate) =>
    existsSync(join(candidate, 'meta', '_journal.json')),
  )
  if (!dir) {
    throw new Error('migrations not found; set BATON_MIGRATIONS_DIR')
  }
  return dir
}

export function migrateDb(db: Database.Database): void {
  migrate(createOrm(db), { migrationsFolder: resolveMigrationsDir() })
}
