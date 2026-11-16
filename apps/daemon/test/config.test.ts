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

  it('fails clearly when the token file is missing', () => {
    expect(() => loadConfig([], { BATON_TOKEN_FILE: '/definitely/missing' })).toThrow(
      /BATON_TOKEN_FILE/,
    )
  })
})
