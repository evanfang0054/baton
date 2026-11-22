import { PlanPayload, type PlanItem, type SupervisorAction } from '@baton/protocol'
import { isActionExpired } from './action.js'

export const PLAN_TTL_MS = 24 * 60 * 60 * 1000

export function buildPlan(input: {
  triggerId: string
  source: { nodeIds: string[] }
  templateId: PlanPayload['templateId']
  items: PlanItem[]
  contextDigest: PlanPayload['contextDigest']
  now: number
}): { payload: PlanPayload; expiresAt: number } {
  const items = input.items.slice(0, 6).map((item) => ({
    ...item,
    contextNodeIds: [...new Set(item.contextNodeIds)].filter(
      (id) => !input.source.nodeIds.includes(id),
    ),
  }))
  return {
    payload: {
      items,
      templateId: input.templateId,
      contextDigest: input.contextDigest.slice(0, 5),
      source: input.source,
      triggerId: input.triggerId,
    },
    expiresAt: input.now + PLAN_TTL_MS,
  }
}

export type PlanValidation =
  | { ok: true; payload: PlanPayload }
  | { ok: false; code: 'plan_invalid' | 'plan_expired' | 'action_not_applicable'; message: string }

export function validatePlanApply(input: {
  action: SupervisorAction
  now: number
  currentPolicyVersion: string
  /** 可选；plan apply 可把失效目标留给逐条失败，从而保留部分成功。 */
  targetExists?: (nodeId: string) => boolean
}): PlanValidation {
  if (input.action.kind !== 'triage_plan') {
    return { ok: false, code: 'action_not_applicable', message: 'action is not a plan' }
  }
  if (input.action.policyVersion !== input.currentPolicyVersion) {
    return { ok: false, code: 'action_not_applicable', message: 'policy changed since proposal' }
  }
  if (isActionExpired(input.action, input.now)) {
    return { ok: false, code: 'plan_expired', message: 'plan expired' }
  }
  const parsed = PlanPayload.safeParse(input.action.payload)
  if (!parsed.success) {
    return { ok: false, code: 'plan_invalid', message: 'plan must contain 1-6 valid items' }
  }
  for (const item of parsed.data.items) {
    if (item.targetNodeId && input.targetExists && !input.targetExists(item.targetNodeId)) {
      return { ok: false, code: 'action_not_applicable', message: 'target node no longer exists' }
    }
  }
  return { ok: true, payload: parsed.data }
}
