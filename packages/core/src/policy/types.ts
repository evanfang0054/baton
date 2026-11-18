import type { RiskLevel } from '@baton/protocol'

export interface PolicyContext {
  killSwitch: boolean
  /** 缺省按未信任处理，避免旧调用点在接线前意外放行。 */
  workspaceTrusted?: boolean
}

export interface PolicyDecision {
  decision: 'allow' | 'deny' | 'ask'
  risk: RiskLevel
  matchedRule?: string
  autoApproved: boolean
  reason: string
}
