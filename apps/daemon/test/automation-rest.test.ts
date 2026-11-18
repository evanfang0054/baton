import { describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers/app.js'

describe('automation REST', () => {
  it('returns a summary and rejects unexpected patch fields', async () => {
    const { app, handle } = await buildTestApp()
    const workspace = handle.seeded

    const response = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.workspaceId}/automation`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ workspaceId: workspace.workspaceId, trusted: true })

    const invalid = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.workspaceId}/automation`,
      payload: { autopilot: { enabled: true, extra: true } },
    })
    expect(invalid.statusCode).toBe(400)
  })

  it('updates automation policy and kill switch', async () => {
    const { app, handle } = await buildTestApp()
    const workspace = handle.seeded

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.workspaceId}/automation`,
      payload: { autopilot: { enabled: true, retryMax: 1 } },
    })
    expect(patch.statusCode).toBe(200)
    expect(patch.json()).toMatchObject({
      policy: { autopilot: { enabled: true, retryMax: 1 } },
    })

    const kill = await app.inject({
      method: 'PUT',
      url: '/api/automation/kill-switch',
      payload: { enabled: true },
    })
    expect(kill.statusCode).toBe(200)
    expect(kill.json()).toEqual({ killSwitch: true, killSwitchForced: false })
  })
})
