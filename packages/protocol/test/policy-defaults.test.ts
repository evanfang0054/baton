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
      'Bash:pnpm {test,lint,typecheck,build,install --frozen-lockfile}',
    ])
    expect(policy.approval.deny).toEqual([
      'Bash:sudo *',
      'Bash:rm -rf *',
      'Bash:curl * | sh',
      'Bash:git push *',
      'Edit:**/.env*',
      'Edit:.git/**',
      'Edit:.baton/**',
      'Write:.baton/**',
    ])
    expect(policy.approval.allow.some((rule) => rule.includes('(test|'))).toBe(false)
  })
})
