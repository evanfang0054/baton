import type Database from 'better-sqlite3'
import type { FastifyInstance } from 'fastify'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildApp } from './app.js'
import type { Config } from './config.js'
import { migrateDb, openDb } from './db/index.js'

export interface BootstrapResult {
  app: FastifyInstance
  db: Database.Database
}

export async function bootstrap(config: Config): Promise<BootstrapResult> {
  mkdirSync(config.dataDir, { recursive: true })
  const db = openDb(join(config.dataDir, 'baton.db'))
  migrateDb(db)
  const app = await buildApp(config)
  return { app, db }
}
