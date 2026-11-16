import cookie from '@fastify/cookie'
import { HealthResponse } from '@baton/protocol'
import Fastify, { type FastifyInstance } from 'fastify'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Config } from './config.js'
import { registerAuth } from './http/auth.js'
import { registerStatic } from './http/static.js'
import { attachWs } from './ws/server.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }
const startedAt = Date.now()

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(cookie)

  const hasWeb = existsSync(config.webRoot)
  registerAuth(app, config, hasWeb)
  if (hasWeb) await registerStatic(app, config.webRoot)

  app.get('/api/health', async () => {
    return HealthResponse.parse({
      status: 'ok',
      version,
      uptimeSec: (Date.now() - startedAt) / 1000,
    })
  })

  await attachWs(app, config)
  return app
}
