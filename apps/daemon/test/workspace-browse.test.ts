import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { browseWorkspaceDirectories } from '../src/workspace/browse.js'

const dirs: string[] = []

function tempDir(prefix = 'baton-browse-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

describe('browseWorkspaceDirectories', () => {
  it('lists visible child directories and marks git repositories', () => {
    const root = tempDir()
    mkdirSync(join(root, 'project-a'))
    mkdirSync(join(root, 'project-b', '.git'), { recursive: true })
    mkdirSync(join(root, '.hidden'))
    writeFileSync(join(root, 'file.txt'), 'x')

    const result = browseWorkspaceDirectories({ root })
    expect(result.path).toBe('')
    expect(result.parent).toBeNull()
    expect(result.searching).toBe(false)
    expect(result.entries.map((entry) => entry.name)).toEqual(['project-a', 'project-b'])
    expect(result.entries.find((entry) => entry.name === 'project-b')?.hasGit).toBe(true)
  })

  it('navigates into a directory and rejects escapes', () => {
    const root = tempDir()
    mkdirSync(join(root, 'a', 'b'), { recursive: true })

    const nested = browseWorkspaceDirectories({ root, path: 'a/b' })
    expect(nested.path).toBe('a/b')
    expect(nested.parent).toBe('a')
    expect(nested.entries.map((entry) => entry.relPath)).toEqual([])

    expect(() => browseWorkspaceDirectories({ root, path: '../outside' })).toThrow(/escapes/)
    expect(() => browseWorkspaceDirectories({ root, path: root })).toThrow(/absolute/)
  })

  it('does not follow symlinks out of the root', () => {
    const root = tempDir()
    const outside = tempDir('baton-outside-')
    symlinkSync(outside, join(root, 'escape'))

    expect(browseWorkspaceDirectories({ root }).entries).toEqual([])
    expect(() => browseWorkspaceDirectories({ root, path: 'escape' })).toThrow(/escapes/)
  })

  it('searches nested directory names within the depth limit', () => {
    const root = tempDir()
    mkdirSync(join(root, 'deep', 'one', 'two', 'needle'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })

    const found = browseWorkspaceDirectories({ root, q: 'needle' })
    expect(found.searching).toBe(true)
    expect(found.entries).toEqual([
      { name: 'needle', relPath: 'deep/one/two/needle', hasGit: false },
    ])

    expect(browseWorkspaceDirectories({ root, q: 'pkg' }).entries).toEqual([])
    expect(browseWorkspaceDirectories({ root, q: 'node_modules' }).entries).toEqual([])
  })

  it('marks results as truncated when the depth limit prunes deeper directories', () => {
    const root = tempDir()
    mkdirSync(join(root, 'a', 'b', 'c', 'd', 'e', 'too-deep'), { recursive: true })

    const found = browseWorkspaceDirectories({ root, q: 'too-deep' })
    expect(found.entries).toEqual([])
    expect(found.truncated).toBe(true)
  })

  it('keeps searching siblings after hitting the depth limit', () => {
    const root = tempDir()
    mkdirSync(join(root, 'aaa', 'a', 'b', 'c', 'd', 'e'), { recursive: true })
    mkdirSync(join(root, 'zzz-match'))

    const found = browseWorkspaceDirectories({ root, q: 'zzz-match' })
    expect(found.entries).toEqual([{ name: 'zzz-match', relPath: 'zzz-match', hasGit: false }])
    expect(found.truncated).toBe(true)
  })

  it('scopes search to the current directory and caps results', () => {
    const root = tempDir()
    mkdirSync(join(root, 'a', 'match-a'), { recursive: true })
    mkdirSync(join(root, 'b', 'match-b'), { recursive: true })
    for (let index = 0; index < 55; index += 1) {
      mkdirSync(join(root, `match-${index.toString().padStart(2, '0')}`))
    }

    expect(browseWorkspaceDirectories({ root, path: 'a', q: 'match' }).entries).toEqual([
      { name: 'match-a', relPath: 'a/match-a', hasGit: false },
    ])

    const capped = browseWorkspaceDirectories({ root, q: 'match' })
    expect(capped.entries).toHaveLength(50)
    expect(capped.truncated).toBe(true)
  })
})
