import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { execa, execaSync } from 'execa'

const TASK_ID = /^[A-Za-z0-9_-]+$/

export type CreateWorktreeResult =
  { ok: true; path: string; branch: string; created: boolean } | { ok: false; reason: string }

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

/** 复用与清理都必须走同一套 jail 判定；realpath 失败按不可信处理。 */
export function isInsideDataDir(dataDir: string, path: string): boolean {
  try {
    const real = realpathSync(path)
    const root = realpathSync(dataDir)
    return real === root || real.startsWith(root + sep)
  } catch {
    return false
  }
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

async function currentBranch(path: string): Promise<string | null> {
  const result = await execa('git', ['-C', path, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    reject: false,
  })
  const branch = result.exitCode === 0 ? result.stdout.trim() : ''
  return branch && branch !== 'HEAD' ? branch : null
}

export async function createWorktree(input: {
  dataDir: string
  workspacePath: string
  taskId: string
  existingPath?: string | null
  /** 复用已有 worktree 时保留它实际所在的分支；验收员会借用目标任务的 worktree。 */
  existingBranch?: string | null
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
    if (!isInsideDataDir(input.dataDir, input.existingPath)) {
      return { ok: false, reason: 'worktree_escape' }
    }
    // 复用别人的 worktree 时，真实分支只能从目录里读；不能拿新 taskId 伪造。
    const actualBranch = input.existingBranch || (await currentBranch(input.existingPath))
    return {
      ok: true,
      path: input.existingPath,
      branch: actualBranch || branch,
      created: false,
    }
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

  if (!isInsideDataDir(input.dataDir, path)) {
    await removeWorktree({ workspacePath: input.workspacePath, path })
    return { ok: false, reason: 'worktree_escape' }
  }
  return { ok: true, path, branch, created: true }
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

/** boot 对账是同步启动路径；prune 只清理元数据，不阻塞事件循环太久。 */
export function pruneWorkspaceSync(workspacePath: string): void {
  execaSync('git', ['-C', workspacePath, 'worktree', 'prune'], { reject: false })
}
