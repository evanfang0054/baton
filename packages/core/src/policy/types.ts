import type { RiskLevel } from '@baton/protocol'

export interface PolicyContext {
  killSwitch: boolean
  workspaceTrusted: boolean
  /** 当前会话是否由总管创建；只有总管任务才可能获得委派授权。 */
  delegatedAuthority?: boolean
  /** 信任工作区 + autopilot + kill switch 关闭时，所有非 deny 请求自动放行。 */
  workspaceAuthority?: boolean
}

export interface PolicyDecision {
  decision: 'allow' | 'deny' | 'ask'
  risk: RiskLevel
  matchedRule?: string
  autoApproved: boolean
  reason: string
  /** 自动放行的授权来源；用于审计区分。 */
  authority?: 'delegated' | 'workspace'
}
