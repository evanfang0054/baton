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

/**
 * 代验收闸门：只有老板显式开启 delegatedAcceptance、工作区可信、kill switch 关闭，
 * 且 autopilot 处于开启状态时才允许自动通过。任务来源与 review 轮次由调用方判定。
 */
export function canDelegatedAcceptance(policy: Policy, gate: AutomationGate): boolean {
  return policy.autopilot.enabled && policy.autopilot.delegatedAcceptance && canAutopilot(gate)
}
