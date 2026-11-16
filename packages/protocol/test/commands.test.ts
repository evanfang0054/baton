import { describe, expect, it } from 'vitest'
import { ClientMessage } from '../src/commands.js'

const fixtures = [
  ['resume', { sinceSeq: 10 }],
  [
    'task.create',
    {
      workspaceId: 'w1',
      nodeId: 'n1',
      title: 'demo',
      prompt: 'do it',
      contextNodeIds: ['n1'],
      engine: 'fake',
    },
  ],
  ['task.enqueue', { taskId: 't1' }],
  ['task.cancel', { taskId: 't1', reason: 'user' }],
  ['approval.decide', { approvalId: 'a1', decision: 'allow' }],
  ['review.decide', { reviewId: 'r1', decision: 'reject', feedback: 'fix it' }],
] as const

describe('ClientMessage', () => {
  it.each(fixtures)('parses %s', (type, payload) => {
    const parsed = ClientMessage.parse({ v: 1, id: 'c1', ts: 1, type, payload })
    expect(parsed.type).toBe(type)
  })

  it('defaults workspaceMode to main', () => {
    const parsed = ClientMessage.parse({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'task.create',
      payload: {
        workspaceId: 'w1',
        nodeId: 'n1',
        title: 'demo',
        prompt: 'do it',
        contextNodeIds: ['n1'],
        engine: 'fake',
      },
    })
    if (parsed.type !== 'task.create') throw new Error('expected task.create')
    expect(parsed.payload.workspaceMode).toBe('main')
  })

  it('requires feedback on reject and rejects it on approve', () => {
    expect(() =>
      ClientMessage.parse({
        v: 1,
        id: 'c1',
        ts: 1,
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'reject' },
      }),
    ).toThrow()
    expect(() =>
      ClientMessage.parse({
        v: 1,
        id: 'c1',
        ts: 1,
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'approve', feedback: 'not allowed' },
      }),
    ).toThrow()
  })

  it('accepts approve without feedback', () => {
    expect(
      ClientMessage.parse({
        v: 1,
        id: 'c1',
        ts: 1,
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'approve' },
      }).type,
    ).toBe('review.decide')
  })
})
