import { describe, expect, it } from 'vitest'
import { applyDelta, applyTool, createStreamState } from './supervisor-model'

describe('supervisor stream projection', () => {
  it('appends deltas and dedupes final message', () => {
    let state = createStreamState()
    state = applyDelta(state, { threadId: 'th1', messageId: 'm1', delta: '正在' })
    state = applyDelta(state, { threadId: 'th1', messageId: 'm1', delta: '建任务' })
    expect(state.text).toBe('正在建任务')

    state = applyTool(state, {
      threadId: 'th1',
      messageId: 'm1',
      toolCallId: 'tc1',
      name: 'create_task',
      phase: 'start',
    })
    expect(state.tools).toEqual([
      { id: 'tc1', name: 'create_task', phase: 'start', ok: undefined, summary: undefined },
    ])

    const finished = applyTool(state, {
      threadId: 'th1',
      messageId: 'm1',
      toolCallId: 'tc1',
      name: 'create_task',
      phase: 'end',
      ok: true,
      summary: '已建到待办',
    })
    expect(finished.tools[0]?.ok).toBe(true)
    expect(finished.tools).toHaveLength(1)
  })

  it('ignores events from another in-flight message', () => {
    const state = applyDelta(createStreamState(), {
      threadId: 'th1',
      messageId: 'm1',
      delta: '第一句',
    })
    const next = applyDelta(state, { threadId: 'th1', messageId: 'm2', delta: '串台' })
    expect(next).toBe(state)
  })
})
