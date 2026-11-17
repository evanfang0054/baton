import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isAppError } from '../src/errors.js'
import { loadPolicy } from '../src/workspace/policy.js'

const dirs: string[] = []

function tempDir(prefix = 'baton-policy-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
    throw new Error('expected function to throw')
  } catch (error) {
    expect(isAppError(error) ? error.code : null).toBe(code)
  }
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

describe('loadPolicy', () => {
  it('falls back to defaults when the file is absent', () => {
    const root = tempDir()
    const policy = loadPolicy(root)
    expect(policy.verify.timeoutSec).toBe(900)
    expect(policy.approval.default).toBe('ask')
    expect(policy.autopilot.enabled).toBe(false)
  })

  it('parses a valid policy file', () => {
    const root = tempDir()
    mkdirSync(join(root, '.baton'))
    writeFileSync(
      join(root, '.baton', 'policy.json'),
      JSON.stringify({
        verify: { command: 'node -e "process.exit(0)"', timeoutSec: 30 },
        autopilot: { enabled: true, retryMax: 1 },
      }),
    )
    const policy = loadPolicy(root)
    expect(policy.verify.command).toBe('node -e "process.exit(0)"')
    expect(policy.verify.timeoutSec).toBe(30)
    expect(policy.autopilot.enabled).toBe(true)
  })

  it('rejects invalid JSON and invalid schema without leaking content', () => {
    const root = tempDir()
    mkdirSync(join(root, '.baton'))
    writeFileSync(join(root, '.baton', 'policy.json'), '{')
    expectCode(() => loadPolicy(root), 'invalid_policy')

    writeFileSync(
      join(root, '.baton', 'policy.json'),
      JSON.stringify({ approval: { autoApproveMaxRisk: 'extreme' } }),
    )
    expectCode(() => loadPolicy(root), 'invalid_policy')
  })

  it('rejects a policy file that escapes the workspace through a symlink', () => {
    const root = tempDir()
    const outside = tempDir('baton-policy-outside-')
    writeFileSync(join(outside, 'policy.json'), JSON.stringify({}))
    mkdirSync(join(root, '.baton'))
    symlinkSync(join(outside, 'policy.json'), join(root, '.baton', 'policy.json'))
    expectCode(() => loadPolicy(root), 'invalid_policy')
  })
})
