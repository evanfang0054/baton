import { describe, expect, it } from 'vitest'
import { PolicySchema } from '../src/policy.js'

describe('policy defaults', () => {
  it('uses glob syntax for the default Bash rule', () => {
    const policy = PolicySchema.parse({})
    expect(policy.approval.allow).toEqual([
      'Read',
      'Grep',
      'Glob',
      'Edit:src/**',
      'Edit:tests/**',
      'Edit:.baton/deliveries/**',
      'Write:.baton/deliveries/**',
      'Bash:pnpm {test,lint,typecheck,build,install --frozen-lockfile}',
    ])
    expect(policy.approval.deny).toEqual([
      'Bash:sudo *',
      'Bash:rm -rf *',
      'Bash:curl * | sh',
      'Bash:git push *',
      'Edit:**/.env*',
      'Edit:.git/**',
      'Edit:.baton/policy.json',
      'Write:.baton/policy.json',
      'Edit:.baton/skills/**',
      'Write:.baton/skills/**',
      'Edit:.baton/playbooks/**',
      'Write:.baton/playbooks/**',
    ])
    expect(policy.approval.allow.some((rule) => rule.includes('(test|'))).toBe(false)
  })
})

describe('autonomy policy defaults', () => {
  it('defaults to observe / off / observe', () => {
    const policy = PolicySchema.parse({})
    expect(policy.autonomy).toEqual({
      mode: 'observe',
      autoRetry: 'off',
      attentionReminder: 'observe',
    })
  })

  it('rejects an unknown autonomy mode', () => {
    expect(PolicySchema.safeParse({ autonomy: { mode: 'always' } }).success).toBe(false)
  })
})
