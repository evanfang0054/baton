import { describe, expect, it } from 'vitest'
import { insertNotice } from '../src/db/repositories.js'
import { buildTestApp } from './helpers/app.js'

describe('notices REST', () => {
  it('lists notices, marks one read and returns 404 for unknown ids', async () => {
    const { app, handle } = await buildTestApp()
    handle.database.db.transaction((tx) => {
      insertNotice(tx, {
        id: 'n1',
        workspaceId: handle.seeded.workspaceId,
        ts: 20,
        kind: 'digest',
        payload: { ready: 1 },
      })
      insertNotice(tx, { id: 'n2', workspaceId: null, ts: 10, kind: 'system', payload: {} })
    })

    const list = await app.inject({
      method: 'GET',
      url: `/api/notices?workspaceId=${handle.seeded.workspaceId}`,
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().notices).toHaveLength(1)
    expect(list.json().notices[0].id).toBe('n1')

    const read = await app.inject({ method: 'POST', url: '/api/notices/n1/read' })
    expect(read.statusCode).toBe(200)
    const after = await app.inject({
      method: 'GET',
      url: `/api/notices?workspaceId=${handle.seeded.workspaceId}`,
    })
    expect(after.json().notices[0].readAt).not.toBeNull()

    const missing = await app.inject({ method: 'POST', url: '/api/notices/missing/read' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().code).toBe('notice_not_found')
  })

  it('filters audit entries by action prefix', async () => {
    const { app } = await buildTestApp()
    expect((await app.inject({ method: 'GET', url: '/api/audit' })).statusCode).toBe(200)
    const bad = await app.inject({ method: 'GET', url: '/api/audit?actionPrefix=Automation' })
    expect(bad.statusCode).toBe(400)
  })
})
