import { describe, expect, it } from 'vitest'
import { PolicySchema } from '@baton/protocol'
import { capabilityAutonomy, effectiveAutonomy } from '../src/supervisor/autonomy.js'

describe('effectiveAutonomy', () => {
  it('never exceeds the global mode', () => {
    expect(effectiveAutonomy('observe', 'auto')).toBe('observe')
    expect(effectiveAutonomy('off', 'observe')).toBe('off')
    expect(effectiveAutonomy('auto', 'observe')).toBe('observe')
  })

  it('turns auto into observe under kill switch, but keeps observe', () => {
    const policy = PolicySchema.parse({
      autonomy: { mode: 'auto', autoRetry: 'auto', attentionReminder: 'observe' },
    })
    expect(capabilityAutonomy(policy, 'autoRetry', { killSwitch: true })).toBe('observe')
    expect(capabilityAutonomy(policy, 'autoRetry', { killSwitch: false })).toBe('auto')
    expect(capabilityAutonomy(policy, 'attentionReminder', { killSwitch: true })).toBe('observe')
  })
})
