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

describe('workspace trust API', () => {
  it('trusts a workspace, records audit and can revoke', async () => {
    const { app, handle } = await setup()
    mkdirSync(join(handle.root, 'demo'))
    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: { name: 'demo', relPath: 'demo' },
    })
    const id = (created.json() as { workspace: { id: string } }).workspace.id

    const trusted = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}/trust`,
      headers: auth,
      payload: { trusted: true, projectHooks: 'on' },
    })
    expect(trusted.statusCode).toBe(200)
    expect(trusted.json()).toMatchObject({
      workspace: { trusted: true, projectHooks: 'on' },
    })

    const audit = handle.database.raw
      .prepare("select action from audit where action like 'workspace.%' order by rowid")
      .all() as Array<{ action: string }>
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(['workspace.trust', 'workspace.project_hooks_changed']),
    )

    const revoked = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}/trust`,
      headers: auth,
      payload: { trusted: false },
    })
    expect(revoked.json()).toMatchObject({
      workspace: { trusted: false, projectHooks: 'on', trustedAt: null },
    })
  })

  it('rejects an unknown workspace and an invalid payload', async () => {
    const { app, handle } = await setup()
    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/workspaces/missing/trust',
      headers: auth,
      payload: { trusted: true },
    })
    expect(missing.statusCode).toBe(404)

    mkdirSync(join(handle.root, 'demo'))
    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: { name: 'demo', relPath: 'demo' },
    })
    const id = (created.json() as { workspace: { id: string } }).workspace.id
    const invalid = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}/trust`,
      headers: auth,
      payload: { trusted: 'yes' },
    })
    expect(invalid.statusCode).toBe(400)
  })
})
