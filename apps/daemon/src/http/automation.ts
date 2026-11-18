import {
  AutomationPolicyPatch,
  AutomationSummary,
  KillSwitchInput,
  KillSwitchResponse,
} from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import type { AutomationService } from '../automation/service.js'
import { appError } from '../errors.js'

export function registerAutomationRoutes(
  app: FastifyInstance,
  deps: { service: AutomationService },
): void {
  app.get('/api/workspaces/:id/automation', async (req) => {
    const { id } = req.params as { id?: string }
    if (!id) throw appError('invalid_payload', 'workspace id is required')
    return AutomationSummary.parse(deps.service.getSummary(id))
  })

  app.patch('/api/workspaces/:id/automation', async (req) => {
    const { id } = req.params as { id?: string }
    if (!id) throw appError('invalid_payload', 'workspace id is required')
    const parsed = AutomationPolicyPatch.safeParse(req.body)
    if (!parsed.success) {
      throw appError('invalid_policy', 'invalid policy patch', parsed.error.issues)
    }
    return AutomationSummary.parse(deps.service.patchPolicy(id, parsed.data))
  })

  app.put('/api/automation/kill-switch', async (req) => {
    const parsed = KillSwitchInput.safeParse(req.body)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid kill switch payload', parsed.error.issues)
    }
    return KillSwitchResponse.parse(deps.service.setKillSwitch(parsed.data.enabled))
  })
}
