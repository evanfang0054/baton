import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEventStore } from '../src/db/event-store.js'
import { createContextService } from '../src/runtime/context-service.js'
import { getTaskDetail, insertNode } from '../src/db/repositories.js'
import { createTestDb, seedTask, seedTextNode } from './helpers/db.js'

function setup(options: { readDrawingContent?: (id: string) => string } = {}) {
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
    ...(options.readDrawingContent ? { readDrawingContent: options.readDrawingContent } : {}),
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

  it('rejects when the cumulative injection budget is exhausted without writing', () => {
    const { database, seeded, service } = setup()
    const promptBefore = database.raw
      .prepare('select prompt from task where id = ?')
      .get(seeded.taskId)
    const injection = (seq: number) => ({
      seq,
      at: seq,
      source: 'user',
      note: null,
      nodeIds: ['text-1'],
      included: [],
      dropped: [],
      truncated: false,
      relations: [],
      relationsTruncated: false,
      chars: 48_000,
    })
    const contextJson = JSON.stringify({
      included: [],
      dropped: [],
      truncated: false,
      redactedPaths: [],
      relations: [],
      relationsTruncated: false,
      injections: [injection(1), injection(2)],
    })
    database.raw
      .prepare('update task set context_json = ? where id = ?')
      .run(contextJson, seeded.taskId)

    const result = service.injectContext({
      taskId: seeded.taskId,
      nodeIds: ['text-1'],
      source: 'user',
      actor: 'human',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('context_budget_exceeded')
    expect(database.raw.prepare('select prompt from task where id = ?').get(seeded.taskId)).toEqual(
      promptBefore,
    )
    expect(
      database.raw.prepare('select context_json from task where id = ?').get(seeded.taskId),
    ).toEqual({ context_json: contextJson })
    expect(
      database.raw
        .prepare("select count(*) as count from audit where action = 'task.context.inject'")
        .get(),
    ).toEqual({ count: 0 })
  })

  it('rejects malformed context_json instead of wiping the snapshot', () => {
    const { database, seeded, service } = setup()
    database.raw
      .prepare('update task set context_json = ? where id = ?')
      .run('{not json', seeded.taskId)

    const result = service.injectContext({
      taskId: seeded.taskId,
      nodeIds: ['text-1'],
      source: 'user',
      actor: 'human',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('context_invalid')
    expect(
      database.raw.prepare('select context_json from task where id = ?').get(seeded.taskId),
    ).toEqual({ context_json: '{not json' })
  })

  it('rejects agent and review nodes as injection sources', () => {
    const { seeded, service } = setup()
    const result = service.injectContext({
      taskId: seeded.taskId,
      nodeIds: [seeded.nodeId],
      source: 'user',
      actor: 'human',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('node_type_not_injectable')
  })

  it('writes a supervisor audit when the source is supervisor', () => {
    const { database, seeded, service } = setup()
    const result = service.injectContext({
      taskId: seeded.taskId,
      nodeIds: ['text-1'],
      source: 'supervisor',
      actor: 'supervisor',
    })
    expect(result.ok).toBe(true)
    const audit = database.raw
      .prepare("select actor from audit where action = 'supervisor.context.inject'")
      .get() as { actor: string } | undefined
    expect(audit).toEqual({ actor: 'supervisor' })
  })

  it('injects drawing text like other content nodes', () => {
    const { database, seeded, service } = setup({
      readDrawingContent: (artifactId) => (artifactId === 'a1' ? '入口 → 支付' : 'unreadable'),
    })
    database.db.transaction((tx) =>
      insertNode(tx, {
        id: 'drawing-1',
        canvasId: seeded.canvasId,
        type: 'drawing',
        x: 0,
        y: 0,
        w: 360,
        h: 260,
        groupId: null,
        data: { artifactId: 'a1', title: '流程草图', thumbnailPath: null, status: 'ready' },
        createdAt: 1,
        updatedAt: 1,
      }),
    )
    const result = service.injectContext({
      taskId: seeded.taskId,
      nodeIds: ['drawing-1'],
      source: 'user',
      actor: 'user',
    })
    expect(result.ok).toBe(true)
    const detail = getTaskDetail(database.db, seeded.taskId)
    expect(detail?.task.prompt).toContain('入口 → 支付')
    expect(detail?.task.context?.injections[0]).toMatchObject({ nodeIds: ['drawing-1'] })
  })
})
