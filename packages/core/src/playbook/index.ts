import { Playbook, type PlaybookStage } from '@baton/protocol'

export interface PlaybookIssue {
  path: string
  message: string
}

export type PlaybookParseResult =
  { ok: true; playbook: Playbook } | { ok: false; issues: PlaybookIssue[] }

const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/

export function validatePlaybook(playbook: Playbook): PlaybookIssue[] {
  const issues: PlaybookIssue[] = []
  const keys = new Set<string>()
  for (const stage of playbook.stages) {
    if (keys.has(stage.key)) {
      issues.push({ path: 'stages', message: `duplicate stage key: ${stage.key}` })
    }
    keys.add(stage.key)
    const names = new Set<string>()
    for (const artifact of stage.produces) {
      if (!SAFE_NAME.test(artifact.name)) {
        issues.push({
          path: `stages.${stage.key}.produces`,
          message: `unsafe artifact name: ${artifact.name}`,
        })
      }
      if (names.has(artifact.name)) {
        issues.push({
          path: `stages.${stage.key}.produces`,
          message: `duplicate artifact name: ${artifact.name}`,
        })
      }
      names.add(artifact.name)
    }
  }
  const last = playbook.stages.at(-1)
  if (last && last.gate !== 'human') {
    issues.push({ path: 'stages', message: 'the last stage must be human' })
  }
  return issues
}

export function parsePlaybook(input: unknown): PlaybookParseResult {
  const parsed = Playbook.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'playbook',
        message: issue.message,
      })),
    }
  }
  const issues = validatePlaybook(parsed.data)
  return issues.length > 0 ? { ok: false, issues } : { ok: true, playbook: parsed.data }
}

export function stageByKey(playbook: Playbook, key: string): PlaybookStage | null {
  return playbook.stages.find((stage) => stage.key === key) ?? null
}

export function stageOrdinal(playbook: Playbook, key: string): number {
  const index = playbook.stages.findIndex((stage) => stage.key === key)
  return index < 0 ? 0 : index + 1
}

export function nextStage(playbook: Playbook, key: string): PlaybookStage | null {
  const index = playbook.stages.findIndex((stage) => stage.key === key)
  return index < 0 ? null : (playbook.stages[index + 1] ?? null)
}
