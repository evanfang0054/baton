import type { RiskLevel } from '@baton/protocol'

export interface PolicyContext {
  killSwitch: boolean
  workspaceTrusted: boolean
  /** 当前会话是否由总管创建；只有总管任务才可能获得委派授权。 */
  delegatedAuthority?: boolean
}

export interface PolicyDecision {
  decision: 'allow' | 'deny' | 'ask'
  risk: RiskLevel
  matchedRule?: string
  autoApproved: boolean
  reason: string
}
