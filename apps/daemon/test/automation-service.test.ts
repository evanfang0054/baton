import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestRuntime } from './helpers/runtime.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(options: { trusted?: boolean; killSwitch?: boolean } = {}): TestRuntimeHandle {
  const handle = createTestRuntime({
    trusted: options.trusted ?? true,
    ...(options.killSwitch ? { config: { killSwitch: true } } : {}),
  })
  handles.push(handle)
  return handle
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

describe('automation service', () => {
  it('returns defaults and writes only the allowed policy fields', () => {
    const handle = setup()
    const summary = handle.runtime.automation.getSummary(handle.seeded.workspaceId)
    expect(summary.trusted).toBe(true)
    expect(summary.policy.autopilot.enabled).toBe(false)

    const updated = handle.runtime.automation.patchPolicy(handle.seeded.workspaceId, {
      autopilot: { enabled: true, retryMax: 3 },
      approval: { autoApproveMaxRisk: 'medium' },
    })
    expect(updated.policy.autopilot).toMatchObject({ enabled: true, retryMax: 3 })
    expect(updated.policy.approval.autoApproveMaxRisk).toBe('medium')
    expect(updated.policyVersion).toMatch(/^[a-f0-9]{12}$/)
    expect(updated.trusted).toBe(true)
  })

  it('rejects policy changes for an untrusted workspace', () => {
    const handle = setup({ trusted: false })
    expect(() =>
      handle.runtime.automation.patchPolicy(handle.seeded.workspaceId, {
        autopilot: { enabled: true },
      }),
    ).toThrowError(/not trusted/)
  })

  it('rejects writes through a .baton symlink escaping the workspace', () => {
    const handle = setup()
    const workspace = join(handle.root, handle.seeded.relPath)
    const outside = join(handle.root, 'outside-baton')
    mkdirSync(outside)
    symlinkSync(outside, join(workspace, '.baton'))
    expect(() =>
      handle.runtime.automation.patchPolicy(handle.seeded.workspaceId, {
        autopilot: { enabled: true },
      }),
    ).toThrowError(/cannot write/)
  })

  it('does not allow disabling an env-forced kill switch', () => {
    const handle = setup({ killSwitch: true })
    const summary = handle.runtime.automation.getSummary(handle.seeded.workspaceId)
    expect(summary.killSwitch).toBe(true)
    expect(summary.killSwitchForced).toBe(true)
    expect(() => handle.runtime.automation.setKillSwitch(false)).toThrowError(/forced/)
  })

  it('persists kill switch changes and returns the new state', () => {
    const handle = setup()
    expect(handle.runtime.automation.setKillSwitch(true)).toEqual({
      killSwitch: true,
      killSwitchForced: false,
    })
    expect(handle.runtime.automation.getSummary(handle.seeded.workspaceId).killSwitch).toBe(true)
    expect(handle.runtime.automation.setKillSwitch(false).killSwitch).toBe(false)
  })
})
