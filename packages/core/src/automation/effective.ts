import type { Policy } from '@baton/protocol'

export interface AutomationGate {
  workspaceTrusted: boolean
  killSwitch: boolean
}

/** 自动化的唯一安全口径：项目配置、workspace 信任与全局 kill switch 同时满足。 */
export function effectiveAutopilot(policy: Policy, gate: AutomationGate): Policy['autopilot'] {
  return {
    ...policy.autopilot,
    enabled: policy.autopilot.enabled && gate.workspaceTrusted && !gate.killSwitch,
  }
}
