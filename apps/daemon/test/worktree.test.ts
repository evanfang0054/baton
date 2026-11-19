import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createWorktree,
  isGitRepo,
  isGitRepoSync,
  pruneWorkspace,
  removeWorktree,
} from '../src/workspace/worktree.js'

const dirs: string[] = []

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'baton-repo-'))
  dirs.push(dir)
  await execa('git', ['-C', dir, 'init', '-q'])
  await execa('git', ['-C', dir, 'config', 'user.email', 'test@example.com'])
  await execa('git', ['-C', dir, 'config', 'user.name', 'test'])
  writeFileSync(join(dir, 'README.md'), 'demo\n')
  await execa('git', ['-C', dir, 'add', '-A'])
  await execa('git', ['-C', dir, 'commit', '-qm', 'init'])
  return dir
}

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-wt-'))
  dirs.push(dir)
  return dir
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
  const result = await execa(
    'git',
    ['-C', repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
    { reject: false },
  )
  return result.exitCode === 0
}

describe('worktree manager', () => {
  it('creates and reuses a worktree branch', async () => {
    const repo = await makeRepo()
    const dataDir = makeDataDir()
    const first = await createWorktree({ dataDir, workspacePath: repo, taskId: 't1' })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.branch).toBe('baton/t1')
    expect(existsSync(first.path)).toBe(true)
    expect(await branchExists(repo, 'baton/t1')).toBe(true)

    const removed = await removeWorktree({ workspacePath: repo, path: first.path })
    expect(removed.ok).toBe(true)
    expect(existsSync(first.path)).toBe(false)
    expect(await branchExists(repo, 'baton/t1')).toBe(true)

    const second = await createWorktree({ dataDir, workspacePath: repo, taskId: 't1' })
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.path).toBe(first.path)
      expect(await branchExists(repo, 'baton/t1')).toBe(true)
    }
  })

  it('rejects reusing a worktree path outside the data dir', async () => {
    const repo = await makeRepo()
    const dataDir = makeDataDir()
    const outside = mkdtempSync(join(tmpdir(), 'baton-outside-'))
    dirs.push(outside)

    const result = await createWorktree({
      dataDir,
      workspacePath: repo,
      taskId: 't1',
      existingPath: outside,
    })
    expect(result).toEqual({ ok: false, reason: 'worktree_escape' })
  })

  it('rejects invalid task ids and non-git workspaces', async () => {
    const repo = await makeRepo()
    const dataDir = makeDataDir()
    const invalid = await createWorktree({ dataDir, workspacePath: repo, taskId: '../escape' })
    expect(invalid).toEqual({ ok: false, reason: 'invalid_task_id' })

    const plain = mkdtempSync(join(tmpdir(), 'baton-plain-'))
    dirs.push(plain)
    const notGit = await createWorktree({ dataDir, workspacePath: plain, taskId: 't1' })
    expect(notGit).toEqual({ ok: false, reason: 'not_a_git_repo' })
  })

  it('detects git repositories synchronously and asynchronously', async () => {
    const repo = await makeRepo()
    const plain = mkdtempSync(join(tmpdir(), 'baton-plain-'))
    dirs.push(plain)
    expect(await isGitRepo(repo)).toBe(true)
    expect(isGitRepoSync(repo)).toBe(true)
    expect(await isGitRepo(plain)).toBe(false)
    expect(isGitRepoSync(plain)).toBe(false)
  })

  it('prunes metadata for a manually removed worktree', async () => {
    const repo = await makeRepo()
    const dataDir = makeDataDir()
    const created = await createWorktree({ dataDir, workspacePath: repo, taskId: 't1' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    rmSync(created.path, { recursive: true, force: true })
    await pruneWorkspace(repo)
    const list = await execa('git', ['-C', repo, 'worktree', 'list', '--porcelain'], {
      reject: false,
    })
    expect(list.stdout).not.toContain(created.path)
  })
})
