import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'
import { getReviewDiff } from '../src/db/repositories.js'
import { branchFor } from '../src/workspace/worktree.js'
import { waitFor } from './helpers/async.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(): TestRuntimeHandle {
  const handle = createTestRuntime({ useSessionRunner: true, useVerifyRunner: true })
  handles.push(handle)
  return handle
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

describe('verify runner', () => {
  it('runs verify and creates a review row on success', async () => {
    const handle = setup()
    const taskId = handle.createTask({ verifyCommand: 'node -e "process.exit(0)"' })
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input', 5000)
    const approval = handle.database.raw
      .prepare('select id from approval where session_id = ?')
      .get(
        (
          handle.database.raw.prepare('select id from session where task_id = ?').get(taskId) as {
            id: string
          }
        ).id,
      ) as { id: string }
    handle.runtime.decideApproval({ approvalId: approval.id, decision: 'allow' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'review', 5000)

    const review = handle.runtime.getReviewByTask(taskId)
    expect(review?.verifyExitCode).toBe(0)
    expect(handle.events.map((event) => event.type)).toContain('verify.result')
  })

  it('creates a failed review when verify exits non-zero', async () => {
    const handle = setup()
    const taskId = handle.createTask({ verifyCommand: 'node -e "process.exit(3)"' })
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input', 5000)
    const session = handle.database.raw
      .prepare('select id from session where task_id = ?')
      .get(taskId) as { id: string }
    const approval = handle.database.raw
      .prepare('select id from approval where session_id = ?')
      .get(session.id) as { id: string }
    handle.runtime.decideApproval({ approvalId: approval.id, decision: 'allow' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'review', 5000)

    const review = handle.runtime.getReviewByTask(taskId)
    expect(review?.verifyExitCode).toBe(3)
  })

  it('persists a diff snapshot on verify', async () => {
    const handle = setup()
    const workspace = join(handle.root, handle.seeded.relPath)
    await execa('git', ['-C', workspace, 'init', '-q'])
    await execa('git', ['-C', workspace, 'config', 'user.email', 'test@example.com'])
    await execa('git', ['-C', workspace, 'config', 'user.name', 'test'])
    writeFileSync(join(workspace, 'a.txt'), 'hello\n')
    await execa('git', ['-C', workspace, 'add', '-A'])
    await execa('git', ['-C', workspace, 'commit', '-qm', 'init'])
    writeFileSync(join(workspace, 'a.txt'), 'hello world\n')

    const taskId = handle.createTask({ verifyCommand: 'node -e "process.exit(0)"' })
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input', 5000)
    const session = handle.database.raw
      .prepare('select id from session where task_id = ?')
      .get(taskId) as { id: string }
    const approval = handle.database.raw
      .prepare('select id from approval where session_id = ?')
      .get(session.id) as { id: string }
    handle.runtime.decideApproval({ approvalId: approval.id, decision: 'allow' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'review', 5000)

    const review = handle.runtime.getReviewByTask(taskId)!
    const snapshot = getReviewDiff(handle.database.db, review.id)
    expect(snapshot?.files.find((file) => file.path === 'a.txt')?.patch).toContain('+hello world')
  })

  it('runs verify and captures diff inside the task worktree', async () => {
    const handle = setup()
    const main = join(handle.root, handle.seeded.relPath)
    await execa('git', ['-C', main, 'init', '-q'])
    await execa('git', ['-C', main, 'config', 'user.email', 'test@example.com'])
    await execa('git', ['-C', main, 'config', 'user.name', 'test'])
    writeFileSync(join(main, 'a.txt'), 'main\n')
    await execa('git', ['-C', main, 'add', '-A'])
    await execa('git', ['-C', main, 'commit', '-qm', 'init'])

    const taskId = handle.createTask({
      workspaceMode: 'worktree',
      verifyCommand:
        "node -e \"const fs=require('fs');process.exit(fs.existsSync('worktree-only.txt')?0:1)\"",
    })
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input', 5000)

    const worktree = handle.runtime.getTask(taskId)!.worktreePath!
    expect(handle.runtime.getTask(taskId)!.branch).toBe(branchFor(taskId))
    writeFileSync(join(worktree, 'worktree-only.txt'), 'wt\n')
    writeFileSync(join(worktree, 'a.txt'), 'changed\n')

    const session = handle.database.raw
      .prepare('select id from session where task_id = ?')
      .get(taskId) as { id: string }
    const approval = handle.database.raw
      .prepare('select id from approval where session_id = ?')
      .get(session.id) as { id: string }
    handle.runtime.decideApproval({ approvalId: approval.id, decision: 'allow' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'review', 5000)

    const review = handle.runtime.getReviewByTask(taskId)!
    expect(review.verifyExitCode).toBe(0)
    // 验收卡与 diff 使用同一份证据：untracked 文件的行数也要计入。
    expect(review.diffStat).toEqual({ filesChanged: 2, insertions: 2, deletions: 1 })
    expect(existsSync(join(main, 'worktree-only.txt'))).toBe(false)
    const snapshot = getReviewDiff(handle.database.db, review.id)
    expect(snapshot?.files.find((file) => file.path === 'a.txt')?.patch).toContain('+changed')
  })

  it('isolates two worktree tasks running in the same workspace', async () => {
    const handle = createTestRuntime({
      useSessionRunner: true,
      useVerifyRunner: true,
      maxConcurrency: 2,
    })
    handles.push(handle)
    const main = join(handle.root, handle.seeded.relPath)
    await execa('git', ['-C', main, 'init', '-q'])
    await execa('git', ['-C', main, 'config', 'user.email', 'test@example.com'])
    await execa('git', ['-C', main, 'config', 'user.name', 'test'])
    writeFileSync(join(main, 'README.md'), 'base\n')
    await execa('git', ['-C', main, 'add', '-A'])
    await execa('git', ['-C', main, 'commit', '-qm', 'init'])

    const first = handle.createTask({
      workspaceMode: 'worktree',
      verifyCommand: 'node -e "process.exit(0)"',
    })
    const second = handle.createTask({
      workspaceMode: 'worktree',
      verifyCommand: 'node -e "process.exit(0)"',
    })
    handle.runtime.applyTransition(first, { type: 'enqueue' })
    handle.runtime.applyTransition(second, { type: 'enqueue' })
    await waitFor(
      () =>
        handle.runtime.getTask(first)?.status === 'waiting_input' &&
        handle.runtime.getTask(second)?.status === 'waiting_input',
      5000,
    )

    const firstTask = handle.runtime.getTask(first)!
    const secondTask = handle.runtime.getTask(second)!
    expect(firstTask.worktreePath).not.toBe(secondTask.worktreePath)
    const branches = await execa('git', ['-C', main, 'branch', '--list', 'baton/*'])
    expect(branches.stdout).toContain(branchFor(first))
    expect(branches.stdout).toContain(branchFor(second))

    writeFileSync(join(firstTask.worktreePath!, 'first.txt'), 'first\n')
    writeFileSync(join(secondTask.worktreePath!, 'second.txt'), 'second\n')

    for (const taskId of [first, second]) {
      const session = handle.database.raw
        .prepare('select id from session where task_id = ?')
        .get(taskId) as { id: string }
      const approval = handle.database.raw
        .prepare('select id from approval where session_id = ?')
        .get(session.id) as { id: string }
      handle.runtime.decideApproval({ approvalId: approval.id, decision: 'allow' })
    }
    await waitFor(
      () =>
        handle.runtime.getTask(first)?.status === 'review' &&
        handle.runtime.getTask(second)?.status === 'review',
      5000,
    )

    const status = await execa('git', ['-C', main, 'status', '--short'])
    expect(status.stdout.trim()).toBe('')
    expect(existsSync(join(main, 'first.txt'))).toBe(false)
    expect(existsSync(join(main, 'second.txt'))).toBe(false)

    const firstDiff = getReviewDiff(handle.database.db, handle.runtime.getReviewByTask(first)!.id)!
    const secondDiff = getReviewDiff(
      handle.database.db,
      handle.runtime.getReviewByTask(second)!.id,
    )!
    expect(firstDiff.files.map((file) => file.path)).toEqual(['first.txt'])
    expect(secondDiff.files.map((file) => file.path)).toEqual(['second.txt'])
  })
})
