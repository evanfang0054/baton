import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readWorkspaceText, resolveWithin, resolveWorkspaceDir } from '../src/workspace/resolver.js'

const dirs: string[] = []

function tempDir(prefix = 'baton-ws-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

describe('resolveWithin', () => {
  it('accepts nested paths inside the root', () => {
    const root = tempDir()
    mkdirSync(join(root, 'packages', 'app'), { recursive: true })
    expect(resolveWithin(root, 'packages/app')).toBe(realpathSync(join(root, 'packages', 'app')))
  })

  it('rejects absolute paths, traversal and empty paths', () => {
    const root = tempDir()
    expect(() => resolveWithin(root, '/etc/passwd')).toThrow(/absolute/)
    expect(() => resolveWithin(root, '../outside')).toThrow(/escapes/)
    expect(() => resolveWithin(root, 'a/../../outside')).toThrow(/escapes/)
    expect(() => resolveWithin(root, '')).toThrow(/empty/)
  })

  it('rejects symlink escapes for existing targets', () => {
    const root = tempDir()
    const outside = tempDir('baton-outside-')
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    symlinkSync(outside, join(root, 'link'))
    expect(() => resolveWithin(root, 'link/secret.txt')).toThrow(/escapes/)
  })

  it('validates workspace directories', () => {
    const root = tempDir()
    mkdirSync(join(root, 'demo'))
    writeFileSync(join(root, 'file.txt'), 'x')
    expect(resolveWorkspaceDir(root, 'demo')).toBe(realpathSync(join(root, 'demo')))
    expect(() => resolveWorkspaceDir(root, 'missing')).toThrow(/not found/)
    expect(() => resolveWorkspaceDir(root, 'file.txt')).toThrow(/not found/)
  })
})

describe('readWorkspaceText', () => {
  it('reads text files and skips sensitive, binary, missing and oversized files', () => {
    const root = tempDir()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'app.ts'), 'export const app = 1\n')
    writeFileSync(join(root, '.env'), 'SECRET=1\n')
    writeFileSync(join(root, 'image.png'), 'not really an image')
    writeFileSync(join(root, 'big.txt'), 'a'.repeat(300 * 1024))

    expect(readWorkspaceText(root, 'src/app.ts')).toContain('export const app')
    expect(readWorkspaceText(root, '.env')).toBeNull()
    expect(readWorkspaceText(root, 'image.png')).toBeNull()
    expect(readWorkspaceText(root, 'big.txt')).toBeNull()
    expect(readWorkspaceText(root, 'missing.txt')).toBeNull()
    expect(readWorkspaceText(root, '../outside.txt')).toBeNull()
  })
})
