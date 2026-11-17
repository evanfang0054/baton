import type { ApprovalRequest, Policy, RiskLevel } from '@baton/protocol'
import { matchRule } from './match.js'
import { classifyRisk, maxRisk } from './risk.js'
import type { PolicyContext, PolicyDecision } from './types.js'

const ORDER: RiskLevel[] = ['low', 'medium', 'high']

function within(risk: RiskLevel, max: RiskLevel): boolean {
  return ORDER.indexOf(risk) <= ORDER.indexOf(max)
}

/**
 * 纯策略求值：deny > allow > ask。
 * decision 表示当前可执行动作：allow 只在自动批准条件全部满足时返回；
 * 命中 allow 但条件不满足时返回 ask，并保留 matchedRule 供审计。
 */
export function evaluateApproval(
  policy: Policy,
  request: ApprovalRequest,
  ctx: PolicyContext,
): PolicyDecision {
  const risk = maxRisk(request.risk, classifyRisk(request.toolName, request.input))

  const denied = policy.approval.deny.find((rule) => matchRule(rule, request))
  if (denied) {
    return {
      decision: 'deny',
      risk,
      matchedRule: denied,
      autoApproved: false,
      reason: `denied by rule ${denied}`,
    }
  }

  const allowed = policy.approval.allow.find((rule) => matchRule(rule, request))
  if (!allowed) {
    return {
      decision: 'ask',
      risk,
      autoApproved: false,
      reason: 'no matching allow rule',
    }
  }

  const auto =
    policy.autopilot.enabled && !ctx.killSwitch && within(risk, policy.approval.autoApproveMaxRisk)

  if (auto) {
    return {
      decision: 'allow',
      risk,
      matchedRule: allowed,
      autoApproved: true,
      reason: `auto-approved by rule ${allowed}`,
    }
  }

  return {
    decision: 'ask',
    risk,
    matchedRule: allowed,
    autoApproved: false,
    reason: `rule ${allowed} matched but auto-approve conditions not met`,
  }
}
