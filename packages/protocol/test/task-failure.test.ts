import { describe, expect, it } from 'vitest'
import { FailureSummary, TaskDetailResponse } from '../src/index.js'

describe('failure summary', () => {
  it('accepts a sanitized summary', () => {
    expect(
      FailureSummary.parse({
        stage: 'verify',
        lastError: 'pnpm test failed at <workspace>/src/login.ts',
        retryable: true,
        affectedPaths: ['src/login.ts'],
        summary: '自动校验未通过',
        createdAt: 1,
      }),
    ).toMatchObject({ stage: 'verify' })
  })

  it('defaults lastFailure to null for old task detail payloads', () => {
    const parsed = TaskDetailResponse.parse({
      task: {
        id: 't1',
        workspaceId: 'w1',
        nodeId: 'a1',
        title: 't',
        prompt: 'p',
        status: 'todo',
        waitingReason: null,
        engine: 'claude-sdk',
        workspaceMode: 'main',
        branch: null,
        worktreePath: null,
        verifyCommand: null,
        retryCount: 0,
        dangerouslySkipPermissions: false,
        enqueuedAt: null,
        createdAt: 1,
        updatedAt: 1,
        context: null,
        origin: null,
      },
      contextInvalid: false,
      originInvalid: false,
      sessions: [],
      approvals: [],
      review: null,
      waitingSince: null,
      attention: 'none',
      acceptance: null,
    })
    expect(parsed.lastFailure).toBeNull()
  })
})
