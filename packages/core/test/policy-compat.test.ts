import { PolicySchema, type Policy } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { upgradeLegacyPolicy } from '../src/policy/compat.js'
import { evaluateApproval } from '../src/policy/evaluate.js'

function legacyPolicy(): Policy {
  return PolicySchema.parse({
    approval: {
      allow: ['Read', 'Write:src/**'],
      deny: ['Edit:.baton/**', 'Write:.baton/**', 'Bash:sudo *'],
    },
    autopilot: { enabled: true, delegatedAuthority: true },
  })
}

describe('upgradeLegacyPolicy', () => {
  it('narrows the legacy .baton blanket deny and keeps custom rules', () => {
    const upgraded = upgradeLegacyPolicy(legacyPolicy())

    expect(upgraded.approval.deny).not.toContain('Edit:.baton/**')
    expect(upgraded.approval.deny).not.toContain('Write:.baton/**')
    expect(upgraded.approval.deny).toContain('Bash:sudo *')
    expect(upgraded.approval.deny).toEqual(
      expect.arrayContaining([
        'Edit:.baton/policy.json',
        'Write:.baton/policy.json',
        'Edit:.baton/skills/**',
        'Write:.baton/playbooks/**',
      ]),
    )
    expect(upgraded.approval.allow).toEqual(
      expect.arrayContaining(['Edit:.baton/deliveries/**', 'Write:.baton/deliveries/**']),
    )
    expect(upgraded.approval.allow).toContain('Write:src/**')
  })

  it('is idempotent and leaves non-legacy policies untouched', () => {
    const upgraded = upgradeLegacyPolicy(legacyPolicy())
    expect(upgradeLegacyPolicy(upgraded)).toBe(upgraded)
    const custom = PolicySchema.parse({ approval: { deny: ['Write:secrets/**'] } })
    expect(upgradeLegacyPolicy(custom)).toBe(custom)
  })

  it('lets delivery artifacts through delegated authority after upgrade', () => {
    const request = {
      toolName: 'Write',
      input: {
        file_path: '.baton/deliveries/ad9fcc48/requirement/spec.md',
        cwd: '/workspace/desktop',
      },
      risk: 'medium' as const,
    }
    const before = evaluateApproval(legacyPolicy(), request, {
      killSwitch: false,
      workspaceTrusted: true,
      delegatedAuthority: true,
      workspaceAuthority: true,
    })
    expect(before.decision).toBe('deny')

    const after = evaluateApproval(upgradeLegacyPolicy(legacyPolicy()), request, {
      killSwitch: false,
      workspaceTrusted: true,
      delegatedAuthority: true,
      workspaceAuthority: true,
    })
    expect(after.decision).toBe('allow')
  })
})
