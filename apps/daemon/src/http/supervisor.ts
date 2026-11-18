import { SUPERVISOR_POLICY } from '@baton/core'
import type { FastifyInstance } from 'fastify'
import { loadSupervisorConfig } from '../supervisor/config.js'

export interface SupervisorRouteDeps {
  dataDir: string
  policyVersion: string
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
}
