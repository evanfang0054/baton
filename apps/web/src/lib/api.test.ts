import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  UnauthorizedError,
  getTaskAcceptance,
  listEngines,
  listWorkspaces,
  updateWorkspaceTrust,
} from './api'

function stubResponse(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api request', () => {
  it('throws UnauthorizedError on 401', async () => {
    stubResponse(401, { code: 'unauthorized', message: 'unauthorized' })
    await expect(listWorkspaces()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('keeps the protocol error code and details', async () => {
    stubResponse(400, {
      code: 'invalid_path',
      message: 'path is outside the workspace root',
      details: { path: '../etc' },
    })
    await expect(listWorkspaces()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'invalid_path',
      details: { path: '../etc' },
    })
    await expect(listWorkspaces()).rejects.toBeInstanceOf(ApiError)
  })

  it('reads engines and patches workspace trust', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init })
        if (String(input) === '/api/engines') {
          return Response.json({
            engines: [
              { engine: 'claude-sdk', status: 'unknown' },
              { engine: 'fake', status: 'available' },
            ],
          })
        }
        return Response.json({
          workspace: {
            id: 'w1',
            name: 'demo',
            relPath: 'demo',
            trusted: true,
            projectHooks: 'off',
            trustedAt: 2,
            createdAt: 1,
          },
        })
      }),
    )
    expect(await listEngines()).toHaveLength(2)
    expect((await updateWorkspaceTrust('w1', { trusted: true })).trusted).toBe(true)
    expect(calls[1]).toMatchObject({
      url: '/api/workspaces/w1/trust',
      init: { method: 'PATCH', body: JSON.stringify({ trusted: true }) },
    })
  })

  it('GET /api/tasks/:id/acceptance maps the report', async () => {
    stubResponse(200, {
      contract: {
        id: 'ac1',
        taskId: 't1',
        version: 1,
        status: 'draft',
        createdBy: 'verifier',
        revision: 0,
        truncated: false,
        createdAt: 1,
        frozenAt: null,
      },
      items: [],
      run: null,
      report: {
        taskId: 't1',
        contractId: 'ac1',
        contractVersion: 1,
        contractRevision: 0,
        goal: '登录页',
        result: '完成',
        changes: { filesChanged: 1, insertions: 2, deletions: 0, files: ['src/login.tsx'] },
        verify: { command: 'pnpm test', exitCode: 0, outputSummary: 'ok', skipped: false },
        acceptance: {
          items: [],
          counts: { total: 1, pass: 1, fail: 0, pending: 0, waived: 0 },
          verdict: 'pass',
        },
        usage: {
          workerCostUsd: 1,
          verifierCostUsd: 0.1,
          turns: 2,
          budgetUsd: 2,
          spentUsd: 1,
          remainingUsd: 1,
          overBudget: false,
          nearBudget: false,
        },
        risks: [],
        unverified: [],
        preliminary: { verdict: 'pass', summary: 'ok' },
        hash: 'a'.repeat(64),
      },
    })

    const result = await getTaskAcceptance('t1')
    expect(result.report.acceptance.counts.pass).toBe(1)
    expect(result.contract.status).toBe('draft')
  })
})
