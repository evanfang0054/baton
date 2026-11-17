import type { RiskLevel } from '@baton/protocol'

const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead'])
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const NETWORK = new Set(['WebFetch', 'WebSearch'])

const HIGH_BASH =
  /(^|\s)(sudo|rm\s+-rf|git\s+push|pnpm\s+add|npm\s+install|yarn\s+add)\b|curl[^|]*\|\s*sh/i
const MEDIUM_BASH = /^(pnpm|npm|yarn)\s+(test|lint|typecheck|build)\b|^git\s+(status|diff|log)\b/i

export function classifyRisk(toolName: string, input: unknown): RiskLevel {
  if (READ_ONLY.has(toolName)) return 'low'
  if (NETWORK.has(toolName)) return 'high'

  if (WRITE_TOOLS.has(toolName)) {
    const record = input as { file_path?: unknown; path?: unknown; cwd?: unknown } | null
    const path = record?.file_path ?? record?.path
    const cwd = record?.cwd
    if (typeof path === 'string' && typeof cwd === 'string' && path.startsWith('/')) {
      return path.startsWith(cwd) ? 'medium' : 'high'
    }
    return 'medium'
  }

  if (toolName === 'Bash' || toolName === 'Shell') {
    const command =
      typeof (input as { command?: unknown } | null)?.command === 'string'
        ? (input as { command: string }).command
        : ''
    if (HIGH_BASH.test(command)) return 'high'
    if (MEDIUM_BASH.test(command)) return 'medium'
    return 'high'
  }

  return 'high'
}

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order = { low: 0, medium: 1, high: 2 } as const
  return order[a] >= order[b] ? a : b
}
