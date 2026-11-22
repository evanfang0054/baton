import { describe, expect, it } from 'vitest'
import { canTransitionAction, isActionExpired } from '../src/supervisor/action.js'

describe('supervisor action state machine', () => {
  it('only allows proposed to terminal states', () => {
    expect(canTransitionAction('proposed', 'applied')).toBe(true)
    expect(canTransitionAction('proposed', 'ignored')).toBe(true)
    expect(canTransitionAction('applied', 'ignored')).toBe(false)
    expect(canTransitionAction('expired', 'applied')).toBe(false)
  })

  it('expires at the boundary', () => {
    expect(isActionExpired({ expiresAt: 100 }, 100)).toBe(true)
    expect(isActionExpired({ expiresAt: 100 }, 99)).toBe(false)
  })
})
