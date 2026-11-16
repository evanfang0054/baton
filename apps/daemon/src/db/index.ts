import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function openDb(file: string): Database.Database {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

function resolveMigrationsDir(): string {
  if (process.env.BATON_MIGRATIONS_DIR) return process.env.BATON_MIGRATIONS_DIR
  const fromRepoRoot = join(process.cwd(), 'apps/daemon/migrations')
  if (existsSync(fromRepoRoot)) return fromRepoRoot
  return join(process.cwd(), 'migrations')
}

export function migrateDb(db: Database.Database): void {
  migrate(drizzle(db), { migrationsFolder: resolveMigrationsDir() })
}
