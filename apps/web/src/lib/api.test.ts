import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  UnauthorizedError,
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
})
