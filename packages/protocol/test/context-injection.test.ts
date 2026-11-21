import { describe, expect, it } from 'vitest'
import {
  ContextInjection,
  ContextInjectInput,
  ContextSnapshot,
  ReviewDecideInput,
  SESSION_USAGE_EVENT,
  ServerMessage,
  Session,
  SessionUsageValue,
  Task,
  TaskTransitionEvent,
} from '../src/index.js'

const injection = {
  seq: 1,
  at: 1_700_000_000_000,
  source: 'user' as const,
  note: '补充报错',
  nodeIds: ['n1'],
  included: [{ id: 'n1', type: 'text' as const, title: '报错', depth: 0, chars: 12 }],
  dropped: [],
  truncated: false,
  relations: [],
  relationsTruncated: false,
  chars: 17,
}

describe('M6-2 protocol', () => {
  it('defaults old ContextSnapshot to empty injections', () => {
    const parsed = ContextSnapshot.parse({
      included: [],
      dropped: [],
      truncated: false,
      redactedPaths: [],
      relations: [],
      relationsTruncated: false,
    })
    expect(parsed.injections).toEqual([])
  })

  it('parses ContextInjection and rejects empty nodeIds', () => {
    expect(ContextInjection.parse(injection)).toEqual(injection)
    expect(ContextInjectInput.safeParse({ taskId: 't1', nodeIds: [] }).success).toBe(false)
    expect(ContextInjectInput.safeParse({ taskId: 't1', nodeIds: ['n1'] }).success).toBe(true)
  })

  it('allows review reject with feedback or context', () => {
    expect(
      ReviewDecideInput.safeParse({ reviewId: 'r1', decision: 'reject', feedback: '改一下' })
        .success,
    ).toBe(true)
    expect(
      ReviewDecideInput.safeParse({
        reviewId: 'r1',
        decision: 'reject',
        contextNodeIds: ['n1'],
      }).success,
    ).toBe(true)
    expect(ReviewDecideInput.safeParse({ reviewId: 'r1', decision: 'reject' }).success).toBe(false)
  })

  it('locks review approve reason and reject limits', () => {
    expect(
      ReviewDecideInput.safeParse({
        reviewId: 'r1',
        decision: 'approve',
        reason: '已知问题，先合',
      }).success,
    ).toBe(true)
    expect(
      ReviewDecideInput.safeParse({ reviewId: 'r1', decision: 'reject', feedback: '   ' }).success,
    ).toBe(false)
    expect(
      ReviewDecideInput.safeParse({
        reviewId: 'r1',
        decision: 'reject',
        contextNodeIds: Array.from({ length: 41 }, (_, index) => `n${index}`),
      }).success,
    ).toBe(false)
    expect(
      ReviewDecideInput.safeParse({
        reviewId: 'r1',
        decision: 'reject',
        feedback: 'x'.repeat(16_385),
      }).success,
    ).toBe(false)
  })

  it('requires contextInjection and contextBlock together', () => {
    expect(
      TaskTransitionEvent.safeParse({
        type: 'reject',
        reviewId: 'r1',
        feedback: '改',
        contextInjection: injection,
      }).success,
    ).toBe(false)
    expect(
      TaskTransitionEvent.safeParse({
        type: 'reject',
        reviewId: 'r1',
        feedback: '改',
        contextBlock: '<context_update/>',
      }).success,
    ).toBe(false)
  })

  it('rejects empty or non-finite session usage', () => {
    expect(SessionUsageValue.safeParse({}).success).toBe(false)
    expect(SessionUsageValue.safeParse({ costUsd: Infinity }).success).toBe(false)
    expect(SessionUsageValue.safeParse({ turns: 3 }).success).toBe(true)
  })

  it('rejects unknown context.inject keys', () => {
    expect(ContextInjectInput.safeParse({ taskId: 't1', nodeIds: ['n1'], extra: 1 }).success).toBe(
      false,
    )
  })

  it('adds task/session fields with defaults', () => {
    const task = Task.parse({
      id: 't1',
      workspaceId: 'w1',
      nodeId: 'a1',
      title: '任务',
      prompt: '做',
      status: 'todo',
      waitingReason: null,
      engine: 'fake',
      workspaceMode: 'main',
      branch: null,
      worktreePath: null,
      verifyCommand: null,
      retryCount: 0,
      dangerouslySkipPermissions: false,
      createdAt: 1,
      updatedAt: 1,
    })
    expect(task.enqueuedAt).toBeNull()
    const session = Session.parse({
      id: 's1',
      taskId: 't1',
      adapter: 'fake',
      engineSessionId: null,
      status: 'running',
      outcome: null,
      startedAt: 1,
      endedAt: null,
    })
    expect(session.costUsd).toBeNull()
    expect(session.turns).toBeNull()
  })

  it('parses transition context and the injected event', () => {
    expect(
      TaskTransitionEvent.safeParse({
        type: 'user_input',
        text: '继续',
        contextInjection: injection,
      }).success,
    ).toBe(true)
    expect(
      TaskTransitionEvent.safeParse({
        type: 'reject',
        reviewId: 'r1',
        feedback: '改',
        contextInjection: injection,
        contextBlock: '<context_update/>',
      }).success,
    ).toBe(true)
    expect(
      ServerMessage.safeParse({
        v: 1,
        ts: 1,
        seq: 1,
        type: 'context.injected',
        payload: { taskId: 't1', seq: 1, at: 1, source: 'user', nodeIds: ['n1'], chars: 17 },
      }).success,
    ).toBe(true)
    expect(SESSION_USAGE_EVENT).toBe('baton.session.usage')
  })
})
