import type { RiskLevel } from '@baton/protocol'

const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead'])
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const NETWORK = new Set(['WebFetch', 'WebSearch'])

const HIGH_BASH =
  /(^|\s)(sudo|rm\s+-rf|git\s+push|pnpm\s+add|npm\s+install|yarn\s+add)\b|curl[^|]*\|\s*sh/i
const MEDIUM_BASH = /^(pnpm|npm|yarn)\s+(test|lint|typecheck|build)\b|^git\s+(status|diff|log)\b/i
// 复合命令可能把高风险动作藏在后半段，例如 `pnpm test; curl ...`。
const SHELL_META = /[;&|`$()<>]/

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+/g, '/')
}

function hasParentSegment(value: string): boolean {
  return value.split('/').includes('..')
}

function isInsideWorkspace(path: string, cwd: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedCwd = normalizePath(cwd).replace(/\/+$/, '')
  if (hasParentSegment(normalizedPath)) return false
  if (!normalizedPath.startsWith('/')) return false
  return normalizedPath === normalizedCwd || normalizedPath.startsWith(`${normalizedCwd}/`)
}

export function classifyRisk(toolName: string, input: unknown): RiskLevel {
  if (READ_ONLY.has(toolName)) return 'low'
  if (NETWORK.has(toolName)) return 'high'

  if (WRITE_TOOLS.has(toolName)) {
    const record = input as { file_path?: unknown; path?: unknown; cwd?: unknown } | null
    const path = record?.file_path ?? record?.path
    const cwd = record?.cwd

    // 无法判定工作区边界时按 high，避免自动批准工作区外写入。
    if (typeof path !== 'string' || typeof cwd !== 'string') return 'high'
    const resolved = path.startsWith('/') ? path : `${cwd}/${path}`
    return isInsideWorkspace(resolved, cwd) ? 'medium' : 'high'
  }

  if (toolName === 'Bash' || toolName === 'Shell') {
    const command =
      typeof (input as { command?: unknown } | null)?.command === 'string'
        ? (input as { command: string }).command
        : ''
    if (HIGH_BASH.test(command)) return 'high'
    if (SHELL_META.test(command)) return 'high'
    if (MEDIUM_BASH.test(command)) return 'medium'
    return 'high'
  }

  return 'high'
}

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order = { low: 0, medium: 1, high: 2 } as const
  return order[a] >= order[b] ? a : b
}
