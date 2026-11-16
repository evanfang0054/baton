import { describe, expect, it } from 'vitest'
import { ConfigSchema } from '../src/config.js'
import { HealthResponse } from '../src/health.js'
import { WsEnvelope, WsPing, WsPong } from '../src/ws.js'

describe('protocol', () => {
  it('accepts a valid health response', () => {
    const parsed = HealthResponse.parse({ status: 'ok', version: '0.0.0', uptimeSec: 1.5 })
    expect(parsed.status).toBe('ok')
  })

  it('rejects health without version', () => {
    expect(() => HealthResponse.parse({ status: 'ok', uptimeSec: 1 })).toThrow()
  })

  it('accepts an envelope carrying a ping and optional seq', () => {
    const envelope = { v: 1, type: 'ping', id: 'a', ts: 1, seq: 7, payload: { id: 'a' } }
    expect(WsEnvelope.parse(envelope).seq).toBe(7)
    expect(WsPing.parse({ type: 'ping', id: 'a' }).id).toBe('a')
    expect(WsPong.parse({ type: 'pong', id: 'a', ts: 2 }).id).toBe('a')
  })

  it('validates daemon config', () => {
    const config = ConfigSchema.parse({
      host: '127.0.0.1',
      port: 7317,
      token: null,
      dataDir: '/tmp/baton',
      webRoot: '/tmp/web',
      workspacesRoot: '/tmp',
    })
    expect(config.port).toBe(7317)
    expect(() => ConfigSchema.parse({ ...config, port: 70000 })).toThrow()
  })
})
