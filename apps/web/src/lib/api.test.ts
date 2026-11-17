import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, UnauthorizedError, listWorkspaces } from './api'

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
})
