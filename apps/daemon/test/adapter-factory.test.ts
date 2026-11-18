import { describe, expect, it } from 'vitest'
import { FakeAdapter } from '@baton/adapters'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'

describe('adapter factory', () => {
  it('builds fake and claude adapters and rejects pty', async () => {
    const factory = createAdapterFactory()
    expect(await factory('fake')).toBeInstanceOf(FakeAdapter)
    expect(await factory('claude-sdk')).toMatchObject({ name: 'claude-sdk' })
    await expect(factory('pty')).rejects.toMatchObject({ code: 'unsupported_engine' })
  })

  it('prefers injected overrides', async () => {
    const fake = new FakeAdapter()
    const factory = createAdapterFactory({ 'claude-sdk': fake })
    expect(await factory('claude-sdk')).toBe(fake)
  })
})
