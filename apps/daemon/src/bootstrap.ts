import type Database from 'better-sqlite3'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildApp } from './app.js'
import type { Config } from './config.js'
import { createOrm, migrateDb, openDb } from './db/index.js'
import type { Db } from './db/types.js'
import { createLogger, type Logger } from './log.js'
import { createAdapterFactory } from './runtime/adapter-factory.js'
import { reconcileOnBoot } from './runtime/boot.js'
import { createEngineRegistry } from './runtime/engines.js'
import { createRuntime, type Runtime } from './runtime/index.js'
import { createWsHub, type WsHub } from './ws/hub.js'

export interface BootstrapResult {
  app: FastifyInstance
  db: Database.Database
  orm: Db
  runtime: Runtime
  hub: WsHub
  logger: Logger
}

export async function bootstrap(config: Config): Promise<BootstrapResult> {
  mkdirSync(config.dataDir, { recursive: true })
  const db = openDb(join(config.dataDir, 'baton.db'))
  migrateDb(db)
  const orm = createOrm(db)
  const now = (): number => Date.now()
  const newId = (): string => randomUUID()
  const logger = createLogger()
  const hub = createWsHub()
  const engines = createEngineRegistry()
  const runtime = createRuntime({
    db: orm,
    config,
    broadcast: (event) => hub.broadcast(event),
    broadcastRaw: (frame) => hub.broadcastRaw(frame),
    adapters: createAdapterFactory(
      {},
      {
        maxTurns: config.claudeMaxTurns,
        maxBudgetUsd: config.claudeMaxBudgetUsd,
        projectHooksGlobal: config.claudeProjectHooks !== 'off',
      },
    ),
    engines,
    now,
    newId,
    logger,
  })

  runtime.beginBoot()
  reconcileOnBoot({ db: orm, applyTransition: runtime.applyTransition, now, newId, logger })

  try {
    const app = await buildApp(config, {
      db: orm,
      runtime,
      engines,
      hub,
      logger,
      now,
      newId,
    })
    return { app, db, orm, runtime, hub, logger }
  } catch (error) {
    await runtime.close()
    db.close()
    throw error
  }
}
