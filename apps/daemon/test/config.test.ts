import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

const dirs: string[] = []

afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }))
})

describe('loadConfig', () => {
  it('defaults to loopback and generates no token', () => {
    const c = loadConfig([], {})
    expect(c.host).toBe('127.0.0.1')
    expect(c.port).toBe(7317)
    expect(c.token).toBeNull()
  })

  it('refuses to bind 0.0.0.0 without a token', () => {
    expect(() => loadConfig(['--host', '0.0.0.0'], {})).toThrow(/BATON_TOKEN/)
  })

  it('accepts a token from env when binding all interfaces', () => {
    const c = loadConfig(['--host', '0.0.0.0'], { BATON_TOKEN: 'secret' })
    expect(c.token).toBe('secret')
  })

  it('reads host and port from env, CLI wins', () => {
    const env = { BATON_HOST: '0.0.0.0', BATON_PORT: '7403', BATON_TOKEN: 'secret' }
    expect(loadConfig([], env).port).toBe(7403)
    expect(loadConfig(['--port', '7500'], env).port).toBe(7500)
  })

  it('reads a token from BATON_TOKEN_FILE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-config-'))
    dirs.push(dir)
    const file = join(dir, 'token')
    writeFileSync(file, 'from-file\n')
    const c = loadConfig([], { BATON_TOKEN_FILE: file })
    expect(c.token).toBe('from-file')
  })

  it('defaults max concurrency to 1 and reads BATON_MAX_CONCURRENCY', () => {
    expect(loadConfig([], {}).maxConcurrency).toBe(1)
    expect(loadConfig([], { BATON_MAX_CONCURRENCY: '3' }).maxConcurrency).toBe(3)
    expect(() => loadConfig([], { BATON_MAX_CONCURRENCY: '0' })).toThrow()
    expect(() => loadConfig([], { BATON_MAX_CONCURRENCY: 'abc' })).toThrow()
  })

  it('defaults maxLiveSessions to 5 and reads BATON_MAX_LIVE_SESSIONS', () => {
    expect(loadConfig([], {}).maxLiveSessions).toBe(5)
    expect(loadConfig([], { BATON_MAX_LIVE_SESSIONS: '3' }).maxLiveSessions).toBe(3)
    expect(() => loadConfig([], { BATON_MAX_LIVE_SESSIONS: '0' })).toThrow()
  })

  it('defaults Claude budget and hooks, and reads overrides', () => {
    const base = loadConfig([], {})
    expect(base.claudeMaxTurns).toBe(30)
    expect(base.claudeMaxBudgetUsd).toBe(2)
    expect(base.claudeProjectHooks).toBe('on')

    const overridden = loadConfig([], {
      BATON_CLAUDE_MAX_TURNS: '10',
      BATON_CLAUDE_MAX_BUDGET_USD: '0.5',
      BATON_CLAUDE_PROJECT_HOOKS: 'off',
    })
    expect(overridden.claudeMaxTurns).toBe(10)
    expect(overridden.claudeMaxBudgetUsd).toBe(0.5)
    expect(overridden.claudeProjectHooks).toBe('off')
    expect(() => loadConfig([], { BATON_CLAUDE_MAX_TURNS: '0' })).toThrow()
  })

  it('reads the global kill switch from BATON_KILL_SWITCH', () => {
    expect(loadConfig([], {}).killSwitch).toBe(false)
    expect(loadConfig([], { BATON_KILL_SWITCH: '1' }).killSwitch).toBe(true)
    expect(loadConfig([], { BATON_KILL_SWITCH: 'true' }).killSwitch).toBe(true)
  })

  it('fails clearly when the token file is missing', () => {
    expect(() => loadConfig([], { BATON_TOKEN_FILE: '/definitely/missing' })).toThrow(
      /BATON_TOKEN_FILE/,
    )
  })
})
