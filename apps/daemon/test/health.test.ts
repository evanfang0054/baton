import { describe, expect, it } from 'vitest'
import { HealthResponse } from '@baton/protocol'
import { buildApp } from '../src/app.js'

describe('GET /api/health', () => {
  it('returns a schema-valid payload', async () => {
    const app = await buildApp({
      host: '127.0.0.1',
      port: 0,
      token: null,
      dataDir: '/tmp',
      webRoot: '/tmp',
    })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(HealthResponse.parse(res.json()).status).toBe('ok')
    await app.close()
  })
})
