import {
  AutomationPolicyPatch,
  AutomationSummary,
  DigestGenerateResponse,
  KillSwitchInput,
  KillSwitchResponse,
} from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import type { DigestService } from '../automation/digest.js'
import type { AutomationService } from '../automation/service.js'
import { appError, isAppError } from '../errors.js'

export function registerAutomationRoutes(
  app: FastifyInstance,
  deps: { service: AutomationService; digest: DigestService },
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

  app.post('/api/workspaces/:id/digest', async (req) => {
    const { id } = req.params as { id?: string }
    if (!id) throw appError('invalid_payload', 'workspace id is required')
    try {
      const notice = deps.digest.generate(id, 'manual')
      if (!notice) throw appError('digest_generation_failed', 'digest generation failed')
      return DigestGenerateResponse.parse({ notice })
    } catch (error) {
      if (
        isAppError(error) &&
        (error.code === 'workspace_not_found' || error.code === 'invalid_policy')
      ) {
        throw error
      }
      throw appError('digest_generation_failed', 'digest generation failed')
    }
  })
}
