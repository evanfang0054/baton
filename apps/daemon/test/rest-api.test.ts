import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TestApp } from './helpers/app.js'
import { buildTestApp } from './helpers/app.js'

const apps: TestApp[] = []
const auth = { authorization: 'Bearer secret' }

async function setup(): Promise<TestApp> {
  const app = await buildTestApp({ config: { token: 'secret' } })
  apps.push(app)
  return app
}

afterEach(async () => {
  const current = apps.splice(0)
  await Promise.all(current.map((app) => app.app.close()))
  await Promise.all(current.map((app) => app.handle.cleanup()))
})

describe('REST API', () => {
  it('keeps health public and requires auth for other API routes', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/workspaces' })).statusCode).toBe(401)
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/workspaces',
          headers: auth,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/workspaces',
          headers: { cookie: 'baton_token=secret' },
        })
      ).statusCode,
    ).toBe(200)
  })

  it('creates a workspace with a canvas and rejects duplicates', async () => {
    const { app, handle } = await setup()
    mkdirSync(join(handle.root, 'new-ws'))

    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: { name: 'new', relPath: 'new-ws' },
    })
    expect(created.statusCode).toBe(201)
    const body = created.json() as {
      workspace: { id: string; relPath: string }
      canvas: { workspaceId: string }
    }
    expect(body.workspace.relPath).toBe('new-ws')
    expect(body.canvas.workspaceId).toBe(body.workspace.id)

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: { name: 'new', relPath: 'new-ws' },
    })
    expect(duplicate.statusCode).toBe(409)

    const escaped = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: { name: 'escape', relPath: '../escape' },
    })
    expect(escaped.statusCode).toBe(400)
  })

  it('reads canvas, tasks and task detail', async () => {
    const { app, handle } = await setup()
    const canvas = await app.inject({
      method: 'GET',
      url: `/api/canvas?workspaceId=${handle.seeded.workspaceId}`,
      headers: auth,
    })
    expect(canvas.statusCode).toBe(200)
    expect((canvas.json() as { nodes: unknown[] }).nodes).toHaveLength(2)

    const tasks = await app.inject({
      method: 'GET',
      url: `/api/tasks?workspaceId=${handle.seeded.workspaceId}`,
      headers: auth,
    })
    expect(tasks.statusCode).toBe(200)
    expect((tasks.json() as { tasks: unknown[] }).tasks).toHaveLength(1)

    const detail = await app.inject({
      method: 'GET',
      url: `/api/tasks/${handle.seeded.taskId}`,
      headers: auth,
    })
    expect(detail.statusCode).toBe(200)
    expect((detail.json() as { review: unknown }).review).toBeNull()

    const missing = await app.inject({
      method: 'GET',
      url: '/api/tasks/missing',
      headers: auth,
    })
    expect(missing.statusCode).toBe(404)
  })
})
