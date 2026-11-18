import type { RiskLevel } from '@baton/protocol'

export interface PolicyContext {
  killSwitch: boolean
  workspaceTrusted: boolean
}

export interface PolicyDecision {
  decision: 'allow' | 'deny' | 'ask'
  risk: RiskLevel
  matchedRule?: string
  autoApproved: boolean
  reason: string
}
