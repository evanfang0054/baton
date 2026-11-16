import Fastify, { type FastifyInstance } from 'fastify'
import { createRequire } from 'node:module'
import { HealthResponse } from '@baton/protocol'
import type { Config } from './config.js'
import { attachWs } from './ws/server.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }
const startedAt = Date.now()

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.get('/api/health', async () => {
    return HealthResponse.parse({
      status: 'ok',
      version,
      uptimeSec: (Date.now() - startedAt) / 1000,
    })
  })
  app.get('/', async (_req, reply) => reply.type('text/html').send('<h1>baton</h1>'))
  await attachWs(app, config)
  return app
}
