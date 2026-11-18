import { describe, expect, it } from 'vitest'
import { boardColumn, needsPerson, waitingSinceFor } from '../src/tasks/board.js'

describe('board projection', () => {
  it('maps internal states to 7 board columns', () => {
    expect(boardColumn('todo')).toBe('todo')
    expect(boardColumn('queued')).toBe('todo')
    expect(boardColumn('running')).toBe('running')
    expect(boardColumn('verifying')).toBe('running')
    expect(boardColumn('waiting_input')).toBe('waiting')
    expect(boardColumn('review')).toBe('review')
    expect(boardColumn('done')).toBe('done')
    expect(boardColumn('cancelled')).toBe('closed')
    expect(boardColumn('failed')).toBe('closed')
  })

  it('marks a person as needed for attention and gate states', () => {
    expect(needsPerson({ status: 'waiting_input', attention: 'needs_approval' })).toBe(true)
    expect(needsPerson({ status: 'review', attention: 'needs_review' })).toBe(true)
    expect(needsPerson({ status: 'waiting_input', attention: 'none' })).toBe(true)
    expect(needsPerson({ status: 'running', attention: 'none' })).toBe(false)
  })

  it('derives waitingSince only for waiting/review', () => {
    expect(waitingSinceFor({ status: 'waiting_input', updatedAt: 5 })).toBe(5)
    expect(waitingSinceFor({ status: 'review', updatedAt: 6 })).toBe(6)
    expect(waitingSinceFor({ status: 'running', updatedAt: 7 })).toBeNull()
    expect(waitingSinceFor({ status: 'done', updatedAt: 8 })).toBeNull()
  })
})
