import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

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
})
