import Fastify, { type FastifyInstance } from 'fastify'
import { HealthResponse } from '@baton/protocol'
import type { Config } from './config.js'

const startedAt = Date.now()
const VERSION = '0.0.0'

export async function buildApp(_config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.get('/api/health', async () => {
    return HealthResponse.parse({
      status: 'ok',
      version: VERSION,
      uptimeSec: (Date.now() - startedAt) / 1000,
    })
  })
  app.get('/', async (_req, reply) => reply.type('text/html').send('<h1>baton</h1>'))
  return app
}
