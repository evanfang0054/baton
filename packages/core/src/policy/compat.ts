import { DEFAULT_APPROVAL_ALLOW, DEFAULT_APPROVAL_DENY, type Policy } from '@baton/protocol'

// M7 之前的默认策略把整个 `.baton/**` 都 deny，交付产物无法落盘。
const LEGACY_BATON_DENY = ['Edit:.baton/**', 'Write:.baton/**']

/**
 * 已存在的 workspace policy 文件不会自动跟随默认值更新。
 * 这里只做窄兼容：仅当策略仍带旧版两条 blanket deny 时，
 * 去掉 blanket，补齐交付目录 allow 与控制面 deny；用户自定义的其他规则原样保留。
 */
export function upgradeLegacyPolicy(policy: Policy): Policy {
  if (!LEGACY_BATON_DENY.every((rule) => policy.approval.deny.includes(rule))) {
    return policy
  }
  const allow = [...policy.approval.allow]
  for (const rule of DEFAULT_APPROVAL_ALLOW) {
    if (rule.includes('.baton/deliveries/') && !allow.includes(rule)) allow.push(rule)
  }
  const deny = policy.approval.deny.filter((rule) => !LEGACY_BATON_DENY.includes(rule))
  for (const rule of DEFAULT_APPROVAL_DENY) {
    if (rule.includes('.baton/') && !deny.includes(rule)) deny.push(rule)
  }
  return {
    ...policy,
    approval: { ...policy.approval, allow, deny },
  }
}
