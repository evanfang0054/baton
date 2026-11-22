import { SUPERVISOR_POLICY } from '@baton/core'
import {
  SupervisorActionListQuery,
  SupervisorActionListResponse,
  SupervisorActionResponse,
  SupervisorMessagesQuery,
  type SupervisorMessagesResponse,
} from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import { appError } from '../errors.js'
import type { createSupervisorActionService } from '../supervisor/actions.js'
import { loadSupervisorConfig } from '../supervisor/config.js'

export interface SupervisorRouteDeps {
  dataDir: string
  policyVersion: string
  history?: (workspaceId: string, limit: number, before?: string) => SupervisorMessagesResponse
  actions?: ReturnType<typeof createSupervisorActionService>
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

  if (deps.actions) {
    app.get('/api/supervisor/actions', async (req) => {
      const parsed = SupervisorActionListQuery.safeParse(req.query)
      if (!parsed.success) {
        throw appError('invalid_payload', 'invalid action query', parsed.error.issues)
      }
      return SupervisorActionListResponse.parse({
        actions: deps.actions!.list(parsed.data.workspaceId, parsed.data.status, parsed.data.limit),
      })
    })

    app.get('/api/supervisor/actions/:id', async (req) => {
      const { id } = req.params as { id?: string }
      if (!id) throw appError('invalid_payload', 'action id is required')
      const action = deps.actions!.get(id)
      if (!action) throw appError('action_not_found', 'action not found', { actionId: id })
      return SupervisorActionResponse.parse({ action })
    })
  }

  if (!deps.history) return
  app.get('/api/supervisor/messages', async (req) => {
    const parsed = SupervisorMessagesQuery.safeParse(req.query)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid supervisor query', parsed.error.issues)
    }
    return deps.history!(parsed.data.workspaceId, parsed.data.limit, parsed.data.before)
  })
}
