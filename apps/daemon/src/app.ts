import cookie from '@fastify/cookie'
import { HealthResponse } from '@baton/protocol'
import { SUPERVISOR_POLICY, supervisorPolicyVersion } from '@baton/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Config } from './config.js'
import type { Db } from './db/types.js'
import { registerApiAuth } from './http/api-auth.js'
import { registerAuth } from './http/auth.js'
import { registerCanvasRoutes } from './http/canvas.js'
import { registerEngineRoutes } from './http/engines.js'
import { registerErrorHandler } from './http/errors.js'
import { registerStatic } from './http/static.js'
import { registerSessionRoutes } from './http/sessions.js'
import { registerSupervisorRoutes } from './http/supervisor.js'
import { registerTaskRoutes } from './http/tasks.js'
import { registerWorkspaceRoutes } from './http/workspaces.js'
import type { Logger } from './log.js'
import type { Runtime } from './runtime/index.js'
import type { EngineRegistry } from './runtime/engines.js'
import { PROMPT_VERSION } from './supervisor/prompt.js'
import type { WsHub } from './ws/hub.js'
import { attachWs } from './ws/server.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }
const startedAt = Date.now()

export interface AppDeps {
  db: Db
  runtime: Runtime
  engines: EngineRegistry
  hub: WsHub
  logger: Logger
  now: () => number
  newId: () => string
}

export async function buildApp(config: Config, deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(cookie)

  registerErrorHandler(app)
  registerApiAuth(app, config)

  const hasWeb = existsSync(config.webRoot)
  registerAuth(app, config, hasWeb)
  if (hasWeb) {
    await registerStatic(app, config.webRoot)
  }

  app.get('/api/health', async () => {
    return HealthResponse.parse({
      status: 'ok',
      version,
      uptimeSec: (Date.now() - startedAt) / 1000,
    })
  })

  registerWorkspaceRoutes(app, {
    db: deps.db,
    config,
    now: deps.now,
    newId: deps.newId,
  })
  registerCanvasRoutes(app, { db: deps.db })
  registerEngineRoutes(app, { engines: deps.engines })
  registerTaskRoutes(app, { db: deps.db, logger: deps.logger })
  registerSessionRoutes(app, { db: deps.db })
  registerSupervisorRoutes(app, {
    dataDir: config.dataDir,
    policyVersion: supervisorPolicyVersion(SUPERVISOR_POLICY, PROMPT_VERSION),
    history: (workspaceId, limit, before) =>
      deps.runtime.supervisor.history(workspaceId, limit, before),
  })

  await attachWs(app, config, deps.runtime, deps.hub)

  app.addHook('onClose', async () => {
    deps.hub.close()
    await deps.runtime.close()
  })

  return app
}
