import type { AutonomyMode, Strength, TaskAction, TaskOrigin } from '@baton/protocol'
import { effectiveAutonomy } from './autonomy.js'
import { supervisorShortHash } from './policy.js'

export const DEFAULT_TASK_ACTIONS: TaskAction[] = [
  'retry',
  'reopen',
  'cancel',
  'reply',
  'inject_context',
  'handoff',
  'update_canvas',
  'enqueue',
  'apply_plan',
]

export interface TaskMandate {
  scope: 'task'
  strength: Strength
  allowedActions: TaskAction[]
  policyVersion: string
  promptVersion: string
  mandateVersion: string
}

export function buildMandate(input: {
  strength: Strength
  allowedActions: TaskAction[]
  policyVersion: string
  promptVersion: string
}): TaskMandate {
  const allowedActions = [...new Set(input.allowedActions)].sort()
  return {
    scope: 'task',
    strength: input.strength,
    allowedActions,
    policyVersion: input.policyVersion,
    promptVersion: input.promptVersion,
    mandateVersion: supervisorShortHash(
      JSON.stringify({
        scope: 'task',
        allowedActions,
        policyVersion: input.policyVersion,
      }),
    ).slice(0, 12),
  }
}

export interface MandateGate {
  workspaceTrusted: boolean
  killSwitch: boolean
  autonomy: AutonomyMode
  capability: AutonomyMode
}

export type MandateValidation =
  | { ok: true }
  | {
      ok: false
      code: 'mandate_revoked'
      reason: string
      detail: {
        requestedAction: TaskAction
        originPolicyVersion: string | null
        currentPolicyVersion: string
        reason: string
      }
    }

export function validateMandate(input: {
  origin: TaskOrigin | null
  requestedAction: TaskAction
  requestedStrength: Strength
  currentPolicyVersion: string
  gate: MandateGate
}): MandateValidation {
  const inferred = input.requestedStrength === 'inferred'
  const revoked = (reason: string): MandateValidation => ({
    ok: false,
    code: 'mandate_revoked',
    reason,
    detail: {
      requestedAction: input.requestedAction,
      originPolicyVersion: input.origin?.policyVersion ?? null,
      currentPolicyVersion: input.currentPolicyVersion,
      reason,
    },
  })

  if (inferred) {
    if (!input.gate.workspaceTrusted) return revoked('workspace_untrusted')
    if (input.gate.killSwitch) return revoked('kill_switch_on')
    if (effectiveAutonomy(input.gate.autonomy, input.gate.capability) !== 'auto') {
      return revoked('autonomy_not_auto')
    }
  }
  if (!input.origin) return inferred ? revoked('missing_mandate') : { ok: true }

  const origin = input.origin
  if (!origin.allowedActions || !origin.mandateVersion || !origin.strength) {
    return revoked('legacy_origin')
  }
  if (!origin.allowedActions.includes(input.requestedAction)) return revoked('action_not_allowed')
  const expected = buildMandate({
    strength: origin.strength,
    allowedActions: origin.allowedActions,
    policyVersion: origin.policyVersion,
    promptVersion: origin.promptVersion,
  }).mandateVersion
  if (origin.mandateVersion !== expected) return revoked('mandate_version_mismatch')
  if (inferred && origin.policyVersion !== input.currentPolicyVersion) {
    return revoked('policy_changed')
  }
  return { ok: true }
}
