import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeEscapesWorkspace } from '../src/workspace/safety.js'

let root: string
let workspace: string
let outside: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'baton-safety-'))
  workspace = join(root, 'workspace')
  outside = join(root, 'outside')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  mkdirSync(outside, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('writeEscapesWorkspace', () => {
  it('allows non-existent paths inside the workspace', () => {
    expect(writeEscapesWorkspace(workspace, 'Edit', { file_path: 'src/a.ts' })).toBe(false)
    expect(writeEscapesWorkspace(workspace, 'Write', { path: 'src/new.ts' })).toBe(false)
  })

  it('rejects parent-directory and symlink escapes', () => {
    writeFileSync(join(outside, 'target.txt'), 'x')
    symlinkSync(outside, join(workspace, 'src', 'link'))
    expect(
      writeEscapesWorkspace(workspace, 'Edit', {
        file_path: join(workspace, 'src', 'link', 'target.txt'),
      }),
    ).toBe(true)
    expect(
      writeEscapesWorkspace(workspace, 'Write', {
        file_path: join(workspace, '..', 'outside', 'x'),
      }),
    ).toBe(true)
  })

  it('ignores non-write tools', () => {
    symlinkSync(outside, join(workspace, 'src', 'link'))
    expect(
      writeEscapesWorkspace(workspace, 'Read', {
        file_path: join(workspace, 'src', 'link', 'target.txt'),
      }),
    ).toBe(false)
  })
})
