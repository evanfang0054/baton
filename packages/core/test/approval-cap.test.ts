import { describe, expect, it } from 'vitest'
import { autoApprovalCapReached } from '../src/index.js'

describe('autoApprovalCapReached', () => {
  it('disables auto approval when cap is 0', () => {
    expect(autoApprovalCapReached({ count: 0, cap: 0 })).toBe(true)
    expect(autoApprovalCapReached({ count: 99, cap: 0 })).toBe(true)
  })

  it('reaches the cap at count >= cap', () => {
    expect(autoApprovalCapReached({ count: 9, cap: 10 })).toBe(false)
    expect(autoApprovalCapReached({ count: 10, cap: 10 })).toBe(true)
    expect(autoApprovalCapReached({ count: 11, cap: 10 })).toBe(true)
  })
})
