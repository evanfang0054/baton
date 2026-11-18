import { EngineListResponse } from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import type { EngineRegistry } from '../runtime/engines.js'

export function registerEngineRoutes(
  app: FastifyInstance,
  deps: { engines: EngineRegistry },
): void {
  app.get('/api/engines', async () => EngineListResponse.parse({ engines: deps.engines.list() }))
}
