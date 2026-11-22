import type { FailureStage, FailureSummary } from '@baton/protocol'

export function normalizeAffectedPaths(paths: string[]): string[] {
  return paths
    .map((path) => path.replaceAll('\\', '/').trim())
    .filter((path) => path.length > 0 && !path.startsWith('/') && !path.startsWith('..'))
    .slice(0, 20)
    .map((path) => path.slice(0, 500))
}

export function sanitizeFailureText(input: {
  text: string
  workspaceRoot?: string
  max?: number
}): string {
  let text = input.text
  if (input.workspaceRoot) {
    text = text.split(input.workspaceRoot).join('<workspace>')
  }
  text = text.replace(/\/(?:Users|home)\/[^/\s]+\//g, '<workspace>/')
  text = text.replace(/\b(token|apiKey|secret|authorization)\s*[:=]\s*\S+/gi, '$1=<redacted>')
  const max = input.max ?? 2000
  return text.length > max ? text.slice(0, max) : text
}

export function buildFailureSummary(input: {
  stage: FailureStage
  message: string
  retryable: boolean
  affectedPaths?: string[]
  summary?: string
  workspaceRoot?: string
  now: number
}): FailureSummary {
  return {
    stage: input.stage,
    lastError: sanitizeFailureText({
      text: input.message,
      ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    }),
    retryable: input.retryable,
    affectedPaths: normalizeAffectedPaths(input.affectedPaths ?? []),
    summary: sanitizeFailureText({
      text: input.summary ?? input.message,
      ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    }),
    createdAt: input.now,
  }
}
