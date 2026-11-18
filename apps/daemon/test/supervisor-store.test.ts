import { describe, expect, it } from 'vitest'
import { createSupervisorStore } from '../src/supervisor/store.js'
import { createTestDb } from './helpers/db.js'

function setup() {
  const database = createTestDb()
  database.raw
    .prepare(
      "insert into workspace (id, name, rel_path, created_at) values ('w1', 'demo', 'demo', 1)",
    )
    .run()
  let index = 0
  const ids = ['th1', 'm1', 'm2', 'd1']
  const value = createSupervisorStore({
    db: database.db,
    now: () => 10,
    newId: () => ids[index++] ?? `id-${index}`,
  })
  return { database, value }
}

describe('supervisor store', () => {
  it('creates one thread per workspace and dedupes trigger', () => {
    const { value } = setup()
    const thread = value.getOrCreateThread('w1')
    expect(thread.id).toBe('th1')
    expect(value.getOrCreateThread('w1').id).toBe('th1')

    const first = value.insertUserMessage({
      threadId: thread.id,
      triggerId: 'r1',
      text: '建任务',
      meta: { contextNodeIds: ['n1'], targetNodeId: 'a1' },
    })
    const duplicate = value.insertUserMessage({
      threadId: thread.id,
      triggerId: 'r1',
      text: '建任务',
      meta: { contextNodeIds: ['n1'], targetNodeId: 'a1' },
    })
    expect(duplicate.duplicate).toBe(true)
    expect(duplicate.message.id).toBe(first.message.id)
  })

  it('inserts an assistant turn and lists messages ascending', () => {
    const { value } = setup()
    const thread = value.getOrCreateThread('w1')
    value.insertUserMessage({
      threadId: thread.id,
      triggerId: 'r1',
      text: '建任务',
      meta: null,
    })
    const turn = value.insertAssistantTurn({
      threadId: thread.id,
      triggerId: 'r1',
      content: '好的',
      toolCalls: [],
      status: 'ok',
      error: null,
      decision: {
        kind: 'chat',
        strength: 'explicit',
        mode: 'explicit',
        reason: 'test',
        taskId: null,
      },
    })
    expect(turn.decision.messageId).toBe(turn.message.id)
    expect(value.listMessages(thread.id, 10).messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ])
    expect(value.getDecisionByTrigger(thread.id, 'r1')?.kind).toBe('chat')
  })

  it('paginates older messages', () => {
    const { value } = setup()
    const thread = value.getOrCreateThread('w1')
    for (let i = 0; i < 3; i += 1) {
      value.insertUserMessage({
        threadId: thread.id,
        triggerId: `r${i}`,
        text: `m${i}`,
        meta: null,
      })
    }
    const page = value.listMessages(thread.id, 2)
    expect(page.messages).toHaveLength(2)
    expect(page.nextBefore).toBeDefined()
    const older = value.listMessages(thread.id, 2, page.nextBefore)
    expect(older.messages).toHaveLength(1)
  })
})
