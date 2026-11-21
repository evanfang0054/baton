import { join } from 'node:path'
import type { AcceptanceItem } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { getAcceptanceResponse } from '../src/acceptance/report-service.js'
import {
  getAcceptanceBundle,
  replaceAcceptanceItems,
  updateAcceptanceRun,
} from '../src/db/acceptance-repository.js'
import { getTask, updateReviewDiff } from '../src/db/repositories.js'
import { resolveWorkspaceDir } from '../src/workspace/resolver.js'
import { createTestRuntime, type TestRuntimeHandle } from './helpers/runtime.js'

function item(
  contractId: string,
  ordinal: number,
  text: string,
  status: AcceptanceItem['status'],
  evidence: string | null = null,
): AcceptanceItem {
  return {
    id: `item-${ordinal}`,
    contractId,
    ordinal,
    text,
    status,
    evidence,
    source: 'verifier',
    updatedAt: 1,
  }
}

function enterReview(handle: TestRuntimeHandle, output: string): void {
  const taskId = handle.seeded.taskId
  handle.runtime.applyTransition(taskId, { type: 'enqueue' })
  handle.runtime.applyTransition(taskId, { type: 'start' })
  handle.runtime.applyTransition(taskId, { type: 'completed' })
  handle.runtime.applyTransition(taskId, {
    type: 'verify_ok',
    reviewId: 'r1',
    exitCode: 0,
    output,
    diffStat: { filesChanged: 2, insertions: 8, deletions: 1 },
  })
}

describe('acceptance report service', () => {
  it('returns null when the task has no acceptance contract', async () => {
    const handle = createTestRuntime()
    const task = getTask(handle.database.db, handle.seeded.taskId)
    expect(task).not.toBeNull()
    expect(getAcceptanceResponse(handle.database.db, task!, handle.config)).toBeNull()
    await handle.cleanup()
  })

  it('derives facts, hashes them, and never leaks absolute paths', async () => {
    const handle = createTestRuntime()
    const workspaceRoot = resolveWorkspaceDir(handle.config.workspacesRoot, handle.seeded.relPath)
    enterReview(handle, `FAIL test/login.test.ts\nroot: ${workspaceRoot}`)

    const bundle = getAcceptanceBundle(handle.database.db, handle.seeded.taskId)
    expect(bundle?.run).not.toBeNull()
    const contractId = bundle!.contract.id

    const replaced = handle.database.db.transaction((tx) =>
      replaceAcceptanceItems(tx, {
        contractId,
        expectedRevision: 0,
        items: [
          item(contractId, 1, '登录成功', 'pass', 'src/login.tsx:1'),
          item(contractId, 2, '错误提示', 'fail', 'src/login.tsx:88'),
          item(contractId, 3, '记住我', 'pending'),
        ],
      }),
    )
    expect(replaced).toMatchObject({ ok: true, revision: 1 })

    updateReviewDiff(handle.database.db, 'r1', {
      v: 1,
      capturedAt: 1,
      baseRef: 'HEAD',
      truncated: false,
      files: [
        {
          path: join(workspaceRoot, 'src/login.tsx'),
          status: 'modified',
          insertions: 5,
          deletions: 1,
          patch: '',
        },
        {
          path: '/external/secret.ts',
          status: 'added',
          insertions: 3,
          deletions: 0,
          patch: '',
        },
      ],
    })

    // 验收员在独立任务里跑，成本要单独计入预算展示。
    const verifier = handle.createTask()
    handle.database.raw
      .prepare(
        `insert into session (id, task_id, adapter, engine_session_id, status, cost_usd, turns, started_at, ended_at)
         values ('verifier-session', ?, 'fake', null, 'ended', 0.125, 1, 2, 3)`,
      )
      .run(verifier)
    handle.database.db.transaction((tx) =>
      updateAcceptanceRun(tx, bundle!.run!.id, { verifierTaskId: verifier }),
    )
    handle.database.raw
      .prepare('update session set cost_usd = 0.5, turns = 2 where id = ?')
      .run(handle.seeded.sessionId)

    const task = getTask(handle.database.db, handle.seeded.taskId)!
    const response = getAcceptanceResponse(handle.database.db, task, handle.config)
    expect(response).not.toBeNull()
    const { report } = response!

    expect(report.goal).toBe('demo')
    expect(report.contractVersion).toBe(1)
    expect(report.contractRevision).toBe(1)
    expect(report.acceptance.counts).toEqual({
      total: 3,
      pass: 1,
      fail: 1,
      pending: 1,
      waived: 0,
    })
    expect(report.acceptance.verdict).toBe('fail')
    expect(report.changes.files).toEqual(['src/login.tsx', '<external>'])
    expect(report.verify.outputSummary).toContain('<workspace>')
    expect(report.usage).toMatchObject({
      workerCostUsd: 0.5,
      verifierCostUsd: 0.125,
      budgetUsd: 2,
      spentUsd: 0.5,
      turns: 2,
    })

    expect(report.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(report)).not.toContain(workspaceRoot)
    expect(JSON.stringify(report)).not.toContain('transcript')
    expect(JSON.stringify(report)).not.toContain('diff --git')

    const again = getAcceptanceResponse(handle.database.db, task, handle.config)
    expect(again?.report.hash).toBe(report.hash)

    await handle.cleanup()
  })
})
