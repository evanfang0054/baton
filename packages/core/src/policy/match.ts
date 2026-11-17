import picomatch from 'picomatch'
import type { ApprovalRequest } from '@baton/protocol'

const PATH_TOOLS = new Set(['Edit', 'Write', 'Read', 'Grep', 'Glob'])

/** 稳定序列化：对象 key 排序，避免 JSON.stringify 的插入顺序影响匹配结果。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
  return `{${entries.join(',')}}`
}

export function matchTarget(toolName: string, input: unknown): string | null {
  if (toolName === 'Bash' || toolName === 'Shell') {
    const command = (input as { command?: unknown } | null)?.command
    return typeof command === 'string' ? command : null
  }
  if (PATH_TOOLS.has(toolName)) {
    const record = input as { file_path?: unknown; path?: unknown } | null
    const path = record?.file_path ?? record?.path
    return typeof path === 'string' ? path : null
  }
  return stableStringify(input)
}

export function matchRule(rule: string, request: ApprovalRequest): boolean {
  const index = rule.indexOf(':')
  if (index < 0) return rule === request.toolName

  const tool = rule.slice(0, index)
  if (tool !== request.toolName) return false

  const target = matchTarget(request.toolName, request.input)
  if (target === null) return false

  const pattern = rule.slice(index + 1)
  // bash 模式让 * 也能匹配 /，因为 Bash 规则匹配的是整条命令字符串。
  return picomatch.isMatch(target, pattern, { dot: true, bash: true })
}
