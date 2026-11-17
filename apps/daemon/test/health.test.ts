import { HealthResponse } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers/app.js'

describe('GET /api/health', () => {
  it('returns a schema-valid payload', async () => {
    const { app, handle } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(HealthResponse.parse(res.json()).status).toBe('ok')
    await app.close()
    await handle.cleanup()
  })
})
