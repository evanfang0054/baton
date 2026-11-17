import type { DiffStat } from '@baton/protocol'
import { execa } from 'execa'
import { sanitizeEnv } from './env.js'
import { truncateOutput } from './output.js'

export interface VerifyCommandRunInput {
  command: string
  workspacePath: string
  timeoutSec: number
  maxOutputBytes: number
  signal?: AbortSignal
}

export interface VerifyCommandRunResult {
  exitCode: number
  output: string
  diffStat: DiffStat
  durationMs: number
}

function isCanceled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { isCanceled?: unknown }).isCanceled === true
  )
}

function isTimedOut(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { timedOut?: unknown }).timedOut === true
  )
}

/** 只统计 tracked 改动与 untracked 文件数；untracked 行数不在 M1 统计。 */
export async function readDiffStat(cwd: string): Promise<DiffStat> {
  const empty: DiffStat = { filesChanged: 0, insertions: 0, deletions: 0 }
  try {
    const numstat = await execa('git', ['-C', cwd, 'diff', '--numstat'], {
      reject: false,
    })
    if (numstat.exitCode !== 0) return empty

    let filesChanged = 0
    let insertions = 0
    let deletions = 0
    for (const line of numstat.stdout.split('\n')) {
      if (!line.trim()) continue
      const [added, deleted] = line.split('\t')
      filesChanged += 1
      insertions += Number(added) || 0
      deletions += Number(deleted) || 0
    }

    const untracked = await execa(
      'git',
      ['-C', cwd, 'ls-files', '--others', '--exclude-standard'],
      { reject: false },
    )
    if (untracked.exitCode === 0) {
      filesChanged += untracked.stdout.split('\n').filter(Boolean).length
    }
    return { filesChanged, insertions, deletions }
  } catch {
    return empty
  }
}

/**
 * 在任务工作区执行 verify 命令。
 * 超时/取消时先杀子进程组，5 秒后再 SIGKILL；输出按头尾截断。
 */
export async function runVerifyCommand(
  input: VerifyCommandRunInput,
): Promise<VerifyCommandRunResult> {
  const started = Date.now()
  const controller = new AbortController()
  let subprocess: ReturnType<typeof execa> | undefined
  const killGroup = (signal: NodeJS.Signals): void => {
    if (!subprocess?.pid) return
    try {
      process.kill(-subprocess.pid, signal)
    } catch {
      // 进程已退出或没有权限；忽略。
    }
  }
  const killTree = (): void => {
    killGroup('SIGTERM')
    const force = setTimeout(() => killGroup('SIGKILL'), 5000)
    force.unref()
  }
  const forwardAbort = (): void => {
    controller.abort()
    killTree()
  }
  input.signal?.addEventListener('abort', forwardAbort, { once: true })

  const timer = setTimeout(
    () => {
      controller.abort()
      killTree()
    },
    Math.max(0, input.timeoutSec) * 1000,
  )
  timer.unref()

  try {
    subprocess = execa(input.command, {
      shell: true,
      cwd: input.workspacePath,
      env: sanitizeEnv(process.env),
      detached: true,
      reject: false,
      cancelSignal: controller.signal,
      forceKillAfterDelay: 5000,
      maxBuffer: Math.max(1024, input.maxOutputBytes * 4),
      timeout: input.timeoutSec * 1000,
    })
    const result = await subprocess
    const output = truncateOutput(
      `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
      input.maxOutputBytes,
    )
    return {
      exitCode:
        result.timedOut || result.isCanceled || controller.signal.aborted
          ? 124
          : (result.exitCode ?? 127),
      output,
      diffStat: await readDiffStat(input.workspacePath),
      durationMs: Date.now() - started,
    }
  } catch (error) {
    const exitCode = controller.signal.aborted || isCanceled(error) || isTimedOut(error) ? 124 : 127
    const message = error instanceof Error ? error.message : 'verify command failed'
    return {
      exitCode,
      output: truncateOutput(message, input.maxOutputBytes),
      diffStat: await readDiffStat(input.workspacePath),
      durationMs: Date.now() - started,
    }
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', forwardAbort)
  }
}
