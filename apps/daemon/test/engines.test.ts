import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEngineRegistry } from '../src/runtime/engines.js'

const dirs: string[] = []

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-engines-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

describe('engine registry', () => {
  it('reports fake as always available and pty as unavailable', () => {
    const registry = createEngineRegistry({
      env: {},
      home: home(),
      sdkMeta: () => ({ available: true, version: 'test' }),
    })
    expect(registry.get('fake')).toMatchObject({ status: 'available' })
    expect(registry.get('pty').status).toBe('unavailable')
  })

  it('reports claude unavailable when the SDK is missing', () => {
    const registry = createEngineRegistry({
      env: {},
      home: home(),
      sdkMeta: () => ({ available: false, version: null }),
    })
    expect(registry.get('claude-sdk').status).toBe('unavailable')
    expect(registry.isAvailable('claude-sdk')).toBe(false)
  })

  it('uses env credentials, then local credentials, then unknown', () => {
    const envRegistry = createEngineRegistry({
      env: { ANTHROPIC_API_KEY: 'set' },
      home: home(),
      sdkMeta: () => ({ available: true, version: 'test' }),
    })
    expect(envRegistry.get('claude-sdk').status).toBe('available')

    const credHome = home()
    mkdirSync(join(credHome, '.claude'), { recursive: true })
    writeFileSync(join(credHome, '.claude', '.credentials.json'), '{}')
    expect(
      createEngineRegistry({
        env: {},
        home: credHome,
        sdkMeta: () => ({ available: true, version: 'test' }),
      }).get('claude-sdk').status,
    ).toBe('available')

    expect(
      createEngineRegistry({
        env: {},
        home: home(),
        sdkMeta: () => ({ available: true, version: 'test' }),
      }).get('claude-sdk').status,
    ).toBe('unknown')
  })

  it('caches probes for 30 seconds', () => {
    let now = 1
    let calls = 0
    const registry = createEngineRegistry({
      env: {},
      home: home(),
      now: () => now,
      sdkMeta: () => {
        calls += 1
        return { available: true, version: 'test' }
      },
    })
    registry.list()
    registry.list()
    expect(calls).toBe(1)
    now += 30_000
    registry.list()
    expect(calls).toBe(2)
  })
})
