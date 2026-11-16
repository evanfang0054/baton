import { describe, expect, it } from 'vitest'
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

  it('accepts an envelope carrying a ping', () => {
    const envelope = { v: 1, type: 'ping', id: 'a', ts: 1, payload: { id: 'a' } }
    expect(WsEnvelope.parse(envelope).type).toBe('ping')
    expect(WsPing.parse({ type: 'ping', id: 'a' }).id).toBe('a')
    expect(WsPong.parse({ type: 'pong', id: 'a', ts: 2 }).id).toBe('a')
  })
})
