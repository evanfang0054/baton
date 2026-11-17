import { describe, expect, it } from 'vitest'
import { statusColumn } from './columns'

describe('statusColumn', () => {
  it.each([
    ['todo', 'todo'],
    ['queued', 'todo'],
    ['running', 'running'],
    ['verifying', 'running'],
    ['waiting_input', 'waiting'],
    ['review', 'review'],
    ['done', 'done'],
    ['cancelled', 'closed'],
    ['failed', 'closed'],
  ] as const)('maps %s to %s', (status, column) => {
    expect(statusColumn(status)).toBe(column)
  })
})
