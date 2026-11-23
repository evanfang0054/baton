import { SUPERVISOR_POLICY } from '@baton/core'
import { describe, expect, it } from 'vitest'
import { SUPERVISOR_PROMPT } from '../src/supervisor/prompt.js'

describe('supervisor prompt length', () => {
  it('stays within the measured 3,222-char budget plus 15%', () => {
    expect(SUPERVISOR_PROMPT.length).toBeLessThanOrEqual(3_705)
  })

  it('names every allowed tool', () => {
    expect(SUPERVISOR_PROMPT).toContain(`${SUPERVISOR_POLICY.allowedTools.length} 个工具`)
    for (const name of SUPERVISOR_POLICY.allowedTools) {
      expect(SUPERVISOR_PROMPT).toContain(name)
    }
  })
})
