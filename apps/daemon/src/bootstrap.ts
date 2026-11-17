import type Database from 'better-sqlite3'
import type { FastifyInstance } from 'fastify'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildApp } from './app.js'
import type { Config } from './config.js'
import { createOrm, migrateDb, openDb } from './db/index.js'
import type { Db } from './db/types.js'

export interface BootstrapResult {
  app: FastifyInstance
  db: Database.Database
  orm: Db
}

export async function bootstrap(config: Config): Promise<BootstrapResult> {
  mkdirSync(config.dataDir, { recursive: true })
  const db = openDb(join(config.dataDir, 'baton.db'))
  migrateDb(db)
  const app = await buildApp(config)
  return { app, db, orm: createOrm(db) }
}
