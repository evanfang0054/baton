import { describe, expect, it } from 'vitest'
import {
  insertApproval,
  insertAudit,
  insertReview,
  updateApprovalDecision,
} from '../src/db/repositories.js'
import { buildTestApp } from './helpers/app.js'

describe('task automation REST', () => {
  it('returns auto decisions and retry metadata without prompt', async () => {
    const { app, handle } = await buildTestApp()
    const taskId = handle.seeded.taskId
    const sessionId = handle.seeded.sessionId!

    handle.database.db.transaction((tx) => {
      insertApproval(tx, {
        id: 'a1',
        sessionId,
        requestId: 'req-1',
        request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'low' },
      })
      updateApprovalDecision(tx, 'a1', 'allow', 'auto', 10)
      insertReview(tx, {
        id: 'r1',
        taskId,
        verdict: null,
        verifyExitCode: 1,
        verifyOutput: 'boom',
        diffStat: { filesChanged: 1, insertions: 1, deletions: 0 },
        decidedAt: null,
      })
      insertAudit(tx, {
        id: 'au1',
        ts: 11,
        actor: 'auto',
        action: 'approval.auto_allow',
        detail: { approvalId: 'a1', taskId, policyVersion: 'abc123abc123' },
      })
      insertAudit(tx, {
        id: 'au2',
        ts: 12,
        actor: 'system',
        action: 'task.retry',
        detail: { taskId, retryCount: 1, policyVersion: 'abc123abc123' },
      })
    })

    const response = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/automation` })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      taskId,
      retryCount: 0,
      lastVerifyExitCode: 1,
      lastPolicyVersion: 'abc123abc123',
      autoDecisions: [
        {
          approvalId: 'a1',
          decision: 'allow',
          toolName: 'Bash',
          risk: 'low',
          policyVersion: 'abc123abc123',
        },
      ],
    })
    expect(response.body).not.toContain('pnpm test')
  })
})
