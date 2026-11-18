import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerSupervisorRoutes } from '../src/http/supervisor.js'

describe('GET /api/supervisor/messages', () => {
  it('parses the query and returns history', async () => {
    const app = Fastify()
    let received: { workspaceId: string; limit: number; before?: string } | undefined
    registerSupervisorRoutes(app, {
      dataDir: '/tmp/none',
      policyVersion: 'p1',
      history: (workspaceId, limit, before) => {
        received = { workspaceId, limit, ...(before ? { before } : {}) }
        return { threadId: 'th1', messages: [] }
      },
    })
    const res = await app.inject({
      method: 'GET',
      url: '/api/supervisor/messages?workspaceId=w1&limit=50',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ threadId: 'th1', messages: [] })
    expect(received).toEqual({ workspaceId: 'w1', limit: 50 })
    await app.close()
  })
})
