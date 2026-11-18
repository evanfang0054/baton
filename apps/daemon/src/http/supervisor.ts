import { SUPERVISOR_POLICY } from '@baton/core'
import { SupervisorMessagesQuery, type SupervisorMessagesResponse } from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import { appError } from '../errors.js'
import { loadSupervisorConfig } from '../supervisor/config.js'

export interface SupervisorRouteDeps {
  dataDir: string
  policyVersion: string
  history?: (workspaceId: string, limit: number, before?: string) => SupervisorMessagesResponse
}

export function registerSupervisorRoutes(app: FastifyInstance, deps: SupervisorRouteDeps): void {
  app.get('/api/supervisor/status', async () => {
    const loaded = loadSupervisorConfig(deps.dataDir)
    return loaded.ok
      ? {
          configured: true,
          model: loaded.config.model,
          mode: SUPERVISOR_POLICY.mode,
          policyVersion: deps.policyVersion,
        }
      : {
          configured: false,
          mode: SUPERVISOR_POLICY.mode,
          policyVersion: deps.policyVersion,
          errorCode: loaded.code,
        }
  })

  if (!deps.history) return
  app.get('/api/supervisor/messages', async (req) => {
    const parsed = SupervisorMessagesQuery.safeParse(req.query)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid supervisor query', parsed.error.issues)
    }
    return deps.history!(parsed.data.workspaceId, parsed.data.limit, parsed.data.before)
  })
}
