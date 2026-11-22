import { describe, expect, it } from 'vitest'
import { buildFailureSummary, normalizeAffectedPaths } from '../src/failures.js'

describe('failure summary', () => {
  it('redacts workspace roots, tokens and absolute paths', () => {
    const summary = buildFailureSummary({
      stage: 'run',
      message: 'token=abc123 failed at /Users/<user>/demo/src/login.ts',
      workspaceRoot: '/Users/<user>/demo',
      retryable: true,
      affectedPaths: ['/Users/<user>/demo/src/login.ts', 'src/login.ts', '../secret', 'src/a.ts'],
      now: 1,
    })
    expect(summary.lastError).toContain('<workspace>/src/login.ts')
    expect(summary.lastError).not.toContain('abc123')
    expect(summary.affectedPaths).toEqual(['src/login.ts', 'src/a.ts'])
  })

  it('truncates to 2k and keeps at most 20 paths', () => {
    const summary = buildFailureSummary({
      stage: 'verify',
      message: 'x'.repeat(3000),
      retryable: false,
      affectedPaths: Array.from({ length: 30 }, (_, index) => `src/${index}.ts`),
      now: 1,
    })
    expect(summary.lastError.length).toBe(2000)
    expect(summary.affectedPaths).toHaveLength(20)
    expect(normalizeAffectedPaths(['src/a.ts', '../x', '/tmp/y'])).toEqual(['src/a.ts'])
  })
})
