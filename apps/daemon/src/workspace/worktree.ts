import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { execa, execaSync } from 'execa'

const TASK_ID = /^[A-Za-z0-9_-]+$/

export type CreateWorktreeResult =
  { ok: true; path: string; branch: string } | { ok: false; reason: string }

export function branchFor(taskId: string): string {
  if (!TASK_ID.test(taskId)) {
    throw new Error('invalid_task_id')
  }
  return `baton/${taskId}`
}

export function worktreePathFor(dataDir: string, taskId: string): string {
  if (!TASK_ID.test(taskId)) {
    throw new Error('invalid_task_id')
  }
  return join(dataDir, 'worktrees', taskId)
}

export async function isGitRepo(path: string): Promise<boolean> {
  const result = await execa('git', ['-C', path, 'rev-parse', '--is-inside-work-tree'], {
    reject: false,
  })
  return result.exitCode === 0 && result.stdout.trim() === 'true'
}

/** task.create 是同步路径；这里用同步 git 探测，避免为一个布尔值把整条命令链改成 async。 */
export function isGitRepoSync(path: string): boolean {
  const result = execaSync('git', ['-C', path, 'rev-parse', '--is-inside-work-tree'], {
    reject: false,
  })
  return result.exitCode === 0 && result.stdout.trim() === 'true'
}

async function branchExists(workspacePath: string, branch: string): Promise<boolean> {
  const result = await execa(
    'git',
    ['-C', workspacePath, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
    { reject: false },
  )
  return result.exitCode === 0
}

export async function createWorktree(input: {
  dataDir: string
  workspacePath: string
  taskId: string
  existingPath?: string | null
}): Promise<CreateWorktreeResult> {
  if (!TASK_ID.test(input.taskId)) {
    return { ok: false, reason: 'invalid_task_id' }
  }
  if (!(await isGitRepo(input.workspacePath))) {
    return { ok: false, reason: 'not_a_git_repo' }
  }
  const branch = branchFor(input.taskId)
  const path = worktreePathFor(input.dataDir, input.taskId)
  if (input.existingPath && existsSync(input.existingPath)) {
    return { ok: true, path: input.existingPath, branch }
  }
  mkdirSync(dirname(path), { recursive: true })
  mkdirSync(input.dataDir, { recursive: true })

  const hasBranch = await branchExists(input.workspacePath, branch)
  const args = hasBranch
    ? ['-C', input.workspacePath, 'worktree', 'add', path, branch]
    : ['-C', input.workspacePath, 'worktree', 'add', '-b', branch, path, 'HEAD']
  const result = await execa('git', args, { reject: false })
  if (result.exitCode !== 0) {
    return { ok: false, reason: 'worktree_create_failed' }
  }

  const real = realpathSync(path)
  const root = realpathSync(input.dataDir)
  if (real !== root && !real.startsWith(root + sep)) {
    await removeWorktree({ workspacePath: input.workspacePath, path })
    return { ok: false, reason: 'worktree_escape' }
  }
  return { ok: true, path, branch }
}

export async function removeWorktree(input: {
  workspacePath: string
  path: string
}): Promise<{ ok: boolean; reason?: string }> {
  if (!existsSync(input.path)) {
    await pruneWorkspace(input.workspacePath)
    return { ok: true }
  }
  const result = await execa(
    'git',
    ['-C', input.workspacePath, 'worktree', 'remove', '--force', input.path],
    { reject: false },
  )
  if (result.exitCode !== 0) {
    await pruneWorkspace(input.workspacePath)
    return { ok: false, reason: 'worktree_remove_failed' }
  }
  return { ok: true }
}

export async function pruneWorkspace(workspacePath: string): Promise<void> {
  await execa('git', ['-C', workspacePath, 'worktree', 'prune'], { reject: false })
}
