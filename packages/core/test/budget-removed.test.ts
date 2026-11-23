import { describe, expect, it } from 'vitest'
import * as core from '../src/index.js'

describe('budget exports removal', () => {
  it('does not export monetary budget helpers', () => {
    expect('budgetState' in core).toBe(false)
    expect('canRaiseBudget' in core).toBe(false)
  })
})
