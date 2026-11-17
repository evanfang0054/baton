import picomatch from 'picomatch'
import type { ApprovalRequest } from '@baton/protocol'

const PATH_TOOLS = new Set(['Edit', 'Write', 'Read', 'Grep', 'Glob'])

export type RuleMatch = 'match' | 'no-match' | 'unextractable'

/** 稳定序列化：对象 key 排序；undefined 归一为 null，保证始终返回 string。 */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>()

  const normalize = (input: unknown): unknown => {
    if (input === undefined) return null
    if (input === null || typeof input !== 'object') return input
    if (input instanceof Date) return input.toISOString()
    if (seen.has(input)) return '[Circular]'
    seen.add(input)
    if (Array.isArray(input)) return input.map(normalize)
    const entries = Object.entries(input as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => [key, normalize(item)] as const)
    return Object.fromEntries(entries)
  }

  return JSON.stringify(normalize(value)) ?? 'null'
}

export function matchTarget(toolName: string, input: unknown): string | null {
  if (toolName === 'Bash' || toolName === 'Shell') {
    const command = (input as { command?: unknown } | null)?.command
    return typeof command === 'string' ? command : null
  }

  if (PATH_TOOLS.has(toolName)) {
    const record = input as { file_path?: unknown; path?: unknown; cwd?: unknown } | null
    const path = record?.file_path ?? record?.path
    if (typeof path !== 'string') return null

    // 引擎通常给绝对路径；如果 cwd 在内，先转成相对路径，默认 Edit:src/** 才能命中。
    const cwd = record?.cwd
    if (typeof cwd === 'string') {
      const normalizedCwd = cwd.replace(/\/+$/, '')
      if (path === normalizedCwd) return '.'
      if (path.startsWith(`${normalizedCwd}/`)) return path.slice(normalizedCwd.length + 1)
    }
    return path
  }

  return stableStringify(input)
}

/**
 * 三态匹配：deny 规则遇到 unextractable 时按 deny 处理（fail-closed）；
 * allow 规则只接受明确的 match。
 */
export function matchRuleResult(rule: string, request: ApprovalRequest): RuleMatch {
  const index = rule.indexOf(':')
  if (index < 0) return rule === request.toolName ? 'match' : 'no-match'

  const tool = rule.slice(0, index)
  if (tool !== request.toolName) return 'no-match'

  const pattern = rule.slice(index + 1).trim()
  if (pattern.length === 0) return 'no-match'

  const target = matchTarget(request.toolName, request.input)
  if (target === null) return 'unextractable'

  const options = tool === 'Bash' || tool === 'Shell' ? { dot: true, bash: true } : { dot: true }

  try {
    return picomatch.isMatch(target, pattern, options) ? 'match' : 'no-match'
  } catch {
    return 'no-match'
  }
}

export function matchRule(rule: string, request: ApprovalRequest): boolean {
  return matchRuleResult(rule, request) === 'match'
}
