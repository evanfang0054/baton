import { describe, expect, it } from 'vitest'
import { resolveVerifyCommand } from '../src/verify/index.js'

describe('resolveVerifyCommand', () => {
  it('prefers the task command', () => {
    expect(
      resolveVerifyCommand({
        taskCommand: 'pnpm test:unit',
        policyCommand: 'pnpm verify',
        packageScripts: { verify: 'vitest run' },
      }),
    ).toEqual({ ok: true, command: 'pnpm test:unit', source: 'task' })
  })

  it('falls back to policy, then package.json, then pnpm test', () => {
    expect(resolveVerifyCommand({ policyCommand: 'pnpm verify' })).toEqual({
      ok: true,
      command: 'pnpm verify',
      source: 'policy',
    })
    expect(
      resolveVerifyCommand({ packageScripts: { verify: 'vitest run' }, packageManager: 'pnpm' }),
    ).toEqual({ ok: true, command: 'pnpm run verify', source: 'package' })
    expect(
      resolveVerifyCommand({ packageScripts: { verify: 'vitest run' }, packageManager: 'npm' }),
    ).toEqual({ ok: true, command: 'npm run verify', source: 'package' })
    expect(
      resolveVerifyCommand({ packageScripts: { test: 'node verify.mjs' }, packageManager: 'npm' }),
    ).toEqual({ ok: true, command: 'npm test', source: 'package' })
    expect(resolveVerifyCommand({})).toEqual({
      ok: true,
      command: 'pnpm test',
      source: 'fallback',
    })
  })

  it('trims commands before using them', () => {
    expect(resolveVerifyCommand({ taskCommand: '  pnpm test  ' })).toEqual({
      ok: true,
      command: 'pnpm test',
      source: 'task',
    })
  })

  it('rejects empty explicit commands', () => {
    const task = resolveVerifyCommand({ taskCommand: '   ' })
    expect(task.ok).toBe(false)
    if (!task.ok) expect(task.error.code).toBe('invalid_payload')

    const policy = resolveVerifyCommand({ policyCommand: '' })
    expect(policy.ok).toBe(false)
    if (!policy.ok) expect(policy.error.code).toBe('invalid_payload')
  })
})
