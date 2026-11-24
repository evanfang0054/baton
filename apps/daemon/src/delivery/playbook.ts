import { parsePlaybook } from '@baton/core'
import type { Playbook } from '@baton/protocol'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { resolveWithin } from '../workspace/resolver.js'

export const STANDARD_PLAYBOOK: Playbook = {
  id: 'standard-delivery',
  version: 1,
  label: '标准交付',
  stages: [
    {
      key: 'requirement',
      label: '需求',
      skill: 'requirement-grooming',
      gate: 'human',
      produces: [{ kind: 'spec', name: 'spec.md', required: true }],
      acceptance: { checklist: ['目标与非目标清楚', '验收标准可执行'], verify: true },
    },
    {
      key: 'design',
      label: '设计',
      skill: 'hi-fi-design',
      gate: 'human',
      produces: [
        { kind: 'prototype', name: 'prototype.html', required: false },
        { kind: 'design', name: 'design.png', required: false },
      ],
      acceptance: { checklist: ['原型可打开', '设计稿与需求一致'], verify: true },
    },
    {
      key: 'build',
      label: '开发',
      skill: 'implement',
      gate: 'auto',
      produces: [{ kind: 'report', name: 'build-report.md', required: false }],
      acceptance: { checklist: [], verify: true },
    },
    {
      key: 'acceptance',
      label: '验收',
      skill: 'acceptance',
      gate: 'human',
      produces: [{ kind: 'report', name: 'acceptance.md', required: false }],
      acceptance: { checklist: ['验收证据可复核', '最终由人拍板'], verify: true },
    },
  ],
}

export type PlaybookLoadResult =
  { ok: true; playbook: Playbook } | { ok: false; code: string; message: string }

export function loadPlaybook(
  workspacePath: string,
  playbookId = 'standard-delivery',
): PlaybookLoadResult {
  for (const ext of ['yaml', 'yml']) {
    const path = resolveWithin(workspacePath, join('.baton', 'playbooks', `${playbookId}.${ext}`))
    if (!existsSync(path)) continue
    try {
      const parsed = parsePlaybook(parseYaml(readFileSync(path, 'utf8')))
      return parsed.ok
        ? { ok: true, playbook: parsed.playbook }
        : {
            ok: false,
            code: 'playbook_invalid',
            message: parsed.issues.map((i) => i.message).join('; '),
          }
    } catch (error) {
      return {
        ok: false,
        code: 'playbook_invalid',
        message: error instanceof Error ? error.message : 'failed to parse playbook',
      }
    }
  }
  if (playbookId === STANDARD_PLAYBOOK.id) {
    return { ok: true, playbook: STANDARD_PLAYBOOK }
  }
  return { ok: false, code: 'playbook_not_found', message: `playbook not found: ${playbookId}` }
}
