import { describe, expect, it } from 'vitest'
import { Workspace } from '../src/entities/workspace.js'

describe('Workspace trust', () => {
  it('round-trips trust fields', () => {
    const parsed = Workspace.parse({
      id: 'w1',
      name: 'demo',
      relPath: 'demo',
      trusted: true,
      projectHooks: 'on',
      trustedAt: 10,
      createdAt: 1,
    })
    expect(parsed).toMatchObject({ trusted: true, projectHooks: 'on', trustedAt: 10 })
  })

  it('rejects an unknown projectHooks mode and a missing trusted flag', () => {
    expect(() =>
      Workspace.parse({
        id: 'w1',
        name: 'demo',
        relPath: 'demo',
        trusted: false,
        projectHooks: 'maybe',
        trustedAt: null,
        createdAt: 1,
      }),
    ).toThrow()
    expect(() =>
      Workspace.parse({
        id: 'w1',
        name: 'demo',
        relPath: 'demo',
        projectHooks: 'off',
        trustedAt: null,
        createdAt: 1,
      }),
    ).toThrow()
  })
})
