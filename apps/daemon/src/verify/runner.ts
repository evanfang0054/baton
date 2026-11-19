import { resolveVerifyCommand } from '@baton/core'
import type { DiffSnapshot, TaskTransitionEvent } from '@baton/protocol'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from '../config.js'
import { getTask, getWorkspace, updateReviewDiff } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import type { Logger } from '../log.js'
import type { TransitionOutcome } from '../runtime/types.js'
import { loadPolicy } from '../workspace/policy.js'
import { resolveWorkspaceDir } from '../workspace/resolver.js'
import { isInsideDataDir } from '../workspace/worktree.js'
import { captureDiff } from './diff.js'
import { runVerifyCommand, type VerifyCommandRunResult } from './executor.js'

export interface VerifyRunnerDeps {
  db: Db
  config: Config
  applyTransition: (taskId: string, event: TaskTransitionEvent) => TransitionOutcome
  now: () => number
  newId: () => string
  verifyMeta: Map<string, number>
  logger?: Logger
}

export interface VerifyRunner {
  run(taskId: string): Promise<void>
  cancel(taskId: string): void
  close(): Promise<void>
}

interface PackageJson {
  scripts?: Record<string, string>
  packageManager?: string
}

function readPackageJson(workspacePath: string): PackageJson | undefined {
  try {
    return JSON.parse(readFileSync(join(workspacePath, 'package.json'), 'utf8')) as PackageJson
  } catch {
    return undefined
  }
}

function packageManagerOf(pkg: PackageJson | undefined): 'pnpm' | 'npm' | 'yarn' {
  const value = pkg?.packageManager
  if (typeof value === 'string') {
    if (value.startsWith('npm@')) {
      return 'npm'
    }
    if (value.startsWith('yarn@')) {
      return 'yarn'
    }
  }
  return 'pnpm'
}

function failure(exitCode: number, output: string): VerifyCommandRunResult {
  return {
    exitCode,
    output,
    diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    durationMs: 0,
  }
}

export function createVerifyRunner(deps: VerifyRunnerDeps): VerifyRunner {
  const active = new Map<string, { controller: AbortController; promise: Promise<void> }>()

  async function execute(taskId: string, signal: AbortSignal): Promise<void> {
    const task = getTask(deps.db, taskId)
    if (!task || task.status !== 'verifying') {
      return
    }

    let result: VerifyCommandRunResult
    let workspacePath: string | null = null
    const workspace = getWorkspace(deps.db, task.workspaceId)
    if (!workspace) {
      result = failure(127, 'workspace not found')
    } else {
      try {
        workspacePath = resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
        if (
          task.workspaceMode === 'worktree' &&
          task.worktreePath &&
          !isInsideDataDir(deps.config.dataDir, task.worktreePath)
        ) {
          throw new Error('worktree path escapes data dir')
        }
        const executionPath = task.worktreePath ?? workspacePath
        const policy = loadPolicy(workspacePath)
        const pkg = readPackageJson(executionPath)
        const resolved = resolveVerifyCommand({
          taskCommand: task.verifyCommand ?? undefined,
          policyCommand: policy.verify.command,
          packageScripts: pkg?.scripts,
          packageManager: packageManagerOf(pkg),
        })
        if (!resolved.ok) {
          result = failure(127, resolved.error.message)
        } else {
          result = await runVerifyCommand({
            command: resolved.command,
            workspacePath: executionPath,
            timeoutSec: policy.verify.timeoutSec,
            maxOutputBytes: policy.verify.maxOutputBytes,
            signal,
          })
        }
      } catch {
        result = failure(127, 'workspace or policy unavailable')
      }
    }

    const current = getTask(deps.db, taskId)
    if (!current || current.status !== 'verifying') {
      return
    }

    let snapshot: DiffSnapshot | null = null
    if (workspacePath) {
      const capturePath = current.worktreePath ?? workspacePath
      if (!current.worktreePath || isInsideDataDir(deps.config.dataDir, current.worktreePath)) {
        try {
          snapshot = await captureDiff(capturePath, deps.now)
        } catch (error) {
          deps.logger?.warn(
            { event: 'diff_capture_failed', taskId, error: String(error) },
            'diff capture failed',
          )
        }
      }
    }

    const reviewId = deps.newId()
    deps.verifyMeta.set(reviewId, result.durationMs)
    const event: TaskTransitionEvent =
      result.exitCode === 0
        ? {
            type: 'verify_ok',
            reviewId,
            exitCode: 0,
            output: result.output,
            diffStat: result.diffStat,
          }
        : {
            type: 'verify_fail',
            reviewId,
            exitCode: result.exitCode,
            output: result.output,
            diffStat: result.diffStat,
          }
    const outcome = deps.applyTransition(taskId, event)
    if (!outcome.ok) {
      deps.verifyMeta.delete(reviewId)
      return
    }
    if (snapshot) {
      updateReviewDiff(deps.db, reviewId, snapshot)
    }
  }

  async function run(taskId: string): Promise<void> {
    if (active.has(taskId)) {
      return
    }
    const controller = new AbortController()
    const promise = execute(taskId, controller.signal).finally(() => {
      active.delete(taskId)
    })
    active.set(taskId, { controller, promise })
    await promise
  }

  function cancel(taskId: string): void {
    active.get(taskId)?.controller.abort()
  }

  async function close(): Promise<void> {
    const entries = [...active.values()]
    for (const entry of entries) {
      entry.controller.abort()
    }
    await Promise.all(entries.map((entry) => entry.promise.catch(() => {})))
  }

  return { run, cancel, close }
}
