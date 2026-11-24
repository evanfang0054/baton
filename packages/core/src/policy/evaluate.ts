import type { ApprovalRequest, Policy, RiskLevel } from '@baton/protocol'
import { canAutopilot } from '../automation/effective.js'
import { matchRuleResult } from './match.js'
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
 * deny 规则遇到无法提取目标的请求时按 deny 处理，保证 fail-closed。
 */
export function evaluateApproval(
  policy: Policy,
  request: ApprovalRequest,
  ctx: PolicyContext,
): PolicyDecision {
  const risk = maxRisk(request.risk, classifyRisk(request.toolName, request.input))

  const denied = policy.approval.deny.find((rule) => matchRuleResult(rule, request) !== 'no-match')
  if (denied) {
    return {
      decision: 'deny',
      risk,
      matchedRule: denied,
      autoApproved: false,
      reason: `denied by rule ${denied}`,
    }
  }

  const allowed = policy.approval.allow.find((rule) => matchRuleResult(rule, request) === 'match')

  // 总管全权：老板显式授权后，总管创建的任务连高风险操作也可自动放行。
  // deny 仍然优先；结构化提问与工作区逃逸仍由调用方降级为人工确认。
  const delegated =
    ctx.delegatedAuthority === true &&
    policy.autopilot.enabled &&
    policy.autopilot.delegatedAuthority &&
    canAutopilot({
      workspaceTrusted: ctx.workspaceTrusted === true,
      killSwitch: ctx.killSwitch,
    })

  if (delegated) {
    return {
      decision: 'allow',
      risk,
      autoApproved: true,
      reason: 'delegated supervisor authority',
      authority: 'delegated',
    }
  }

  // 工作区授权：信任工作区 + 自动驾驶开启 + kill switch 关闭时，所有非 deny 放行。
  // deny 已在最前面返回，因此这里不会绕过安全规则。
  const workspaceAuthority =
    ctx.workspaceAuthority === true &&
    policy.autopilot.enabled &&
    canAutopilot({
      workspaceTrusted: ctx.workspaceTrusted === true,
      killSwitch: ctx.killSwitch,
    })

  if (workspaceAuthority) {
    return {
      decision: 'allow',
      risk,
      autoApproved: true,
      reason: 'workspace authority',
      authority: 'workspace',
    }
  }

  if (!allowed) {
    return {
      decision: policy.approval.default,
      risk,
      autoApproved: false,
      reason: 'no matching allow rule',
    }
  }

  const auto =
    risk !== 'high' &&
    policy.autopilot.enabled &&
    canAutopilot({
      workspaceTrusted: ctx.workspaceTrusted === true,
      killSwitch: ctx.killSwitch,
    }) &&
    within(risk, policy.approval.autoApproveMaxRisk)

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
