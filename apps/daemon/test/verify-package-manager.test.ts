import { describe, expect, it } from 'vitest'
import { detectPackageManager } from '../src/verify/package-manager.js'

function files(...names: string[]): (name: string) => boolean {
  const set = new Set(names)
  return (name) => set.has(name)
}

describe('detectPackageManager', () => {
  it('uses the packageManager field when it is explicit', () => {
    expect(detectPackageManager({ packageManager: 'npm@10.9.0', hasFile: files() })).toBe('npm')
    expect(detectPackageManager({ packageManager: 'pnpm@10.27.0', hasFile: files() })).toBe('pnpm')
    expect(detectPackageManager({ packageManager: 'yarn@4.4.0', hasFile: files() })).toBe('yarn')
  })

  it('detects pnpm from its lockfile', () => {
    expect(detectPackageManager({ hasFile: files('pnpm-lock.yaml') })).toBe('pnpm')
  })

  it('detects pnpm from a workspace file without a lockfile', () => {
    expect(detectPackageManager({ hasFile: files('pnpm-workspace.yaml') })).toBe('pnpm')
  })

  it('detects yarn from yarn.lock', () => {
    expect(detectPackageManager({ hasFile: files('yarn.lock') })).toBe('yarn')
  })

  it('detects npm from package-lock.json or npm-shrinkwrap.json', () => {
    expect(detectPackageManager({ hasFile: files('package-lock.json') })).toBe('npm')
    expect(detectPackageManager({ hasFile: files('npm-shrinkwrap.json') })).toBe('npm')
  })

  it('falls back to npm when the project has no package manager clues', () => {
    // 默认 npm：Node 自带，不会像 corepack 一样在 verify 时改写 package.json。
    expect(detectPackageManager({ hasFile: files() })).toBe('npm')
  })

  it('prefers the lockfile over an incomplete packageManager string', () => {
    expect(
      detectPackageManager({ packageManager: 'not-a-manager', hasFile: files('pnpm-lock.yaml') }),
    ).toBe('pnpm')
  })
})
