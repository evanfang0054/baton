import { describe, expect, it } from 'vitest'
import { ScriptedAdapter } from './helpers/scripted-adapter.js'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'

describe('adapter factory', () => {
  it('builds the claude adapter and rejects pty', async () => {
    const factory = createAdapterFactory()
    expect(await factory('claude-sdk')).toMatchObject({ name: 'claude-sdk' })
    await expect(factory('pty')).rejects.toMatchObject({ code: 'unsupported_engine' })
  })

  it('prefers injected overrides', async () => {
    const scripted = new ScriptedAdapter()
    const factory = createAdapterFactory({ 'claude-sdk': scripted })
    expect(await factory('claude-sdk')).toBe(scripted)
  })
})
