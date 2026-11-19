import type { Policy } from '@baton/protocol'

export interface AutomationGate {
  workspaceTrusted: boolean
  killSwitch: boolean
}

/** 自动化的唯一安全口径：workspace 信任且 kill switch 明确关闭。 */
export function canAutopilot(gate: AutomationGate): boolean {
  return gate.workspaceTrusted === true && gate.killSwitch === false
}

export function effectiveAutopilot(policy: Policy, gate: AutomationGate): Policy['autopilot'] {
  return {
    ...policy.autopilot,
    enabled: policy.autopilot.enabled && canAutopilot(gate),
  }
}
