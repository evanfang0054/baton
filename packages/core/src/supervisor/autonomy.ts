import type { AutonomyMode, Policy } from '@baton/protocol'

const RANK: Record<AutonomyMode, number> = { off: 0, observe: 1, auto: 2 }

export function effectiveAutonomy(global: AutonomyMode, capability: AutonomyMode): AutonomyMode {
  return RANK[capability] <= RANK[global] ? capability : global
}

export function capabilityAutonomy(
  policy: Policy,
  capability: 'autoRetry' | 'attentionReminder',
  gate: { killSwitch: boolean },
): AutonomyMode {
  const mode = effectiveAutonomy(policy.autonomy.mode, policy.autonomy[capability])
  return gate.killSwitch && mode === 'auto' ? 'observe' : mode
}
