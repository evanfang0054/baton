import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEventStore } from '../src/db/event-store.js'
import { createContextService } from '../src/runtime/context-service.js'
import { getTaskDetail } from '../src/db/repositories.js'
import { createTestDb, seedTask, seedTextNode } from './helpers/db.js'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'baton-m6-svc-'))
  const database = createTestDb()
  const seeded = seedTask(database.raw, { taskStatus: 'todo', withSession: false })
  seedTextNode(database.raw, seeded.canvasId, 'text-1', '登录页需求')
  mkdirSync(join(root, seeded.relPath), { recursive: true })
  let tick = 1
  const eventStore = createEventStore(database.db, { now: () => tick++, newId: () => `e-${tick}` })
  const transitions: unknown[] = []
  const service = createContextService({
    db: database.db,
    config: {
      host: '127.0.0.1',
      port: 0,
      token: null,
      dataDir: root,
      webRoot: root,
      workspacesRoot: root,
      maxConcurrency: 1,
      maxLiveSessions: 5,
      claudeMaxTurns: 30,
      claudeMaxBudgetUsd: 2,
      claudeProjectHooks: 'on',
      allowBypassPermissions: false,
      killSwitch: false,
    },
    eventStore,
    applyTransition: (taskId, event) => {
      transitions.push(event)
      return {
        ok: true,
        taskId,
        status: 'running',
        previousStatus: 'waiting_input',
        retryCount: 0,
        waitingReason: null,
        events: [],
      }
    },
    hasSession: () => true,
    broadcast: () => {},
    now: () => 1_700_000_000_000,
    newId: () => `id-${tick++}`,
  })
  return { database, seeded, service, transitions }
}

describe('context service', () => {
  it('appends a context_update block and injection for todo', () => {
    const { database, seeded, service } = setup()
    const result = service.injectContext({
      taskId: seeded.taskId,
      nodeIds: ['text-1'],
      note: '补充',
      source: 'user',
      actor: 'user',
    })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(result.ok).toBe(true)
    const detail = getTaskDetail(database.db, seeded.taskId)
    expect(detail?.task.prompt).toContain('<context_update seq="1"')
    expect(detail?.task.prompt).toContain('<note>补充</note>')
    expect(detail?.task.context?.injections).toHaveLength(1)
  })

  it('rejects approval and review states without writing', () => {
    const { database, seeded, service } = setup()
    database.raw
      .prepare("update task set status = 'waiting_input', waiting_reason = 'approval' where id = ?")
      .run(seeded.taskId)
    const approval = service.injectContext({
      taskId: seeded.taskId,
      nodeIds: ['text-1'],
      source: 'user',
      actor: 'user',
    })
    expect(approval.ok).toBe(false)
    if (!approval.ok) expect(approval.error.code).toBe('task_not_injectable')

    database.raw
      .prepare("update task set status = 'review', waiting_reason = null where id = ?")
      .run(seeded.taskId)
    const review = service.injectContext({
      taskId: seeded.taskId,
      nodeIds: ['text-1'],
      source: 'user',
      actor: 'user',
    })
    expect(review.ok).toBe(false)
    if (!review.ok) expect(review.error.code).toBe('task_not_injectable')
    const prepared = service.prepareContextInjection(
      { taskId: seeded.taskId, nodeIds: ['text-1'], source: 'user', actor: 'user' },
      { allowReview: true },
    )
    expect(prepared.ok).toBe(true)
    expect(getTaskDetail(database.db, seeded.taskId)?.task.context?.injections ?? []).toHaveLength(
      0,
    )
  })

  it('uses the user_input transition for waiting_input', () => {
    const { database, seeded, service, transitions } = setup()
    database.raw
      .prepare("update task set status = 'waiting_input', waiting_reason = 'question' where id = ?")
      .run(seeded.taskId)
    const result = service.injectContext({
      taskId: seeded.taskId,
      nodeIds: ['text-1'],
      source: 'user',
      actor: 'user',
    })
    expect(result.ok).toBe(true)
    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toMatchObject({ type: 'user_input' })
    if (
      transitions[0] &&
      typeof transitions[0] === 'object' &&
      'contextInjection' in transitions[0]
    ) {
      expect(transitions[0].contextInjection).toMatchObject({ seq: 1, nodeIds: ['text-1'] })
    }
  })
})
