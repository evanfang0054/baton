import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sanitizeEnv } from '../src/verify/env.js'
import { readDiffStat, runVerifyCommand } from '../src/verify/executor.js'
import { truncateOutput } from '../src/verify/output.js'

const dirs: string[] = []

function tempDir(prefix = 'baton-verify-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

describe('verify output', () => {
  it('keeps head and tail while truncating the middle', () => {
    const out = truncateOutput('a'.repeat(100) + 'b'.repeat(100), 40)
    expect(out).toContain('truncated')
    expect(out.startsWith('a'.repeat(20))).toBe(true)
    expect(out.endsWith('b'.repeat(20))).toBe(true)
  })

  it('does not truncate small output', () => {
    expect(truncateOutput('ok', 40)).toBe('ok')
  })
})

describe('sanitizeEnv', () => {
  it('strips baton, anthropic and credential-like keys', () => {
    const env = sanitizeEnv({
      PATH: '/usr/bin',
      HOME: '/home/user',
      BATON_TOKEN: 'secret',
      ANTHROPIC_API_KEY: 'secret',
      MY_API_KEY: 'secret',
      GITHUB_TOKEN: 'secret',
      AUTHORIZATION: 'secret',
    })
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/user' })
  })
})

describe('runVerifyCommand', () => {
  it('returns the command exit code', async () => {
    const dir = tempDir()
    const ok = await runVerifyCommand({
      command: 'node -e "process.exit(0)"',
      workspacePath: dir,
      timeoutSec: 5,
      maxOutputBytes: 1024,
    })
    expect(ok.exitCode).toBe(0)
    expect(ok.diffStat).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 })

    const failed = await runVerifyCommand({
      command: 'node -e "process.exit(3)"',
      workspacePath: dir,
      timeoutSec: 5,
      maxOutputBytes: 1024,
    })
    expect(failed.exitCode).toBe(3)
  })

  it('returns 124 when the command times out', async () => {
    const dir = tempDir()
    const result = await runVerifyCommand({
      command: 'node -e "setTimeout(() => {}, 60000)"',
      workspacePath: dir,
      timeoutSec: 1,
      maxOutputBytes: 1024,
    })
    expect(result.exitCode).toBe(124)
  })

  it('counts tracked changes and untracked files', async () => {
    const dir = tempDir()
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    execFileSync('git', ['add', '.'], { cwd: dir })
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir })
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    writeFileSync(join(dir, 'b.txt'), 'new\n')
    execFileSync('git', ['add', 'a.txt'], { cwd: dir })

    const stat = await readDiffStat(dir)
    expect(stat.filesChanged).toBe(2)
    expect(stat.insertions).toBe(1)
    expect(stat.deletions).toBe(0)
  })

  it('adds a PATH hint for command-not-found failures', async () => {
    const result = await runVerifyCommand({
      command: 'definitely-not-a-command',
      workspacePath: tempDir(),
      timeoutSec: 5,
      maxOutputBytes: 4096,
    })
    expect(result.exitCode).toBe(127)
    expect(result.output).toContain('命令未找到')
    expect(result.output).toContain('PATH=')
    expect(result.output).not.toContain('ANTHROPIC_API_KEY')
  })
})
