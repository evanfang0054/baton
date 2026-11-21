import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SUPERVISOR_POLICY } from '@baton/core'
import type { DiffSnapshot, Node } from '@baton/protocol'
import { getNode, insertReview, updateReviewDiff } from '../src/db/repositories.js'
import { createHandoffNode } from '../src/handoff/service.js'
import { createTaskService } from '../src/runtime/task-service.js'
import { createSupervisorTools, type ToolContext } from '../src/supervisor/tools.js'
import { createTestDb, seedTask, type SeededTask, type TestDb } from './helpers/db.js'

function textContent(node: Node | null | undefined): string {
  return node?.type === 'text' ? node.data.content : ''
}

const dirs: string[] = []
const dbs: TestDb[] = []

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dbs.splice(0).forEach((entry) => entry.raw.close())
})

function setup(options: { status?: 'review' | 'done' | 'failed' | 'cancelled' | 'running' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baton-handoff-'))
  dirs.push(root)
  const database = createTestDb()
  dbs.push(database)
  const seeded = seedTask(database.raw, {
    taskStatus: options.status ?? 'review',
    sessionStatus: 'ended',
  })
  mkdirSync(join(root, seeded.relPath), { recursive: true })
  return { root, database, seeded }
}

function addReview(database: TestDb, seeded: SeededTask): void {
  if (!seeded.sessionId) throw new Error('seedTask must create a session')
  database.raw.prepare('update session set outcome = ? where id = ?').run('ready', seeded.sessionId)
  database.raw
    .prepare(
      `insert into event (id, session_id, ordinal, seq, type, payload_json, ts)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'event-1',
      seeded.sessionId,
      1,
      1,
      'TEXT_MESSAGE_CONTENT',
      JSON.stringify({ messageId: 'm1', delta: '已完成登录页改造，补了移动端断点。' }),
      1,
    )
  database.db.transaction((tx) =>
    insertReview(tx, {
      id: 'review-1',
      taskId: seeded.taskId,
      verdict: null,
      verifyExitCode: 0,
      verifyOutput: '',
      diffStat: { filesChanged: 1, insertions: 10, deletions: 2 },
      decidedAt: null,
    }),
  )
  const snapshot: DiffSnapshot = {
    v: 1,
    capturedAt: 1,
    baseRef: 'HEAD',
    truncated: false,
    files: [
      { path: 'src/login.tsx', status: 'modified', insertions: 10, deletions: 2, patch: '@@' },
    ],
  }
  updateReviewDiff(database.db, 'review-1', snapshot)
}

function config(root: string) {
  return {
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
    claudeProjectHooks: 'on' as const,
    allowBypassPermissions: false,
    killSwitch: false,
  }
}

function toolContext(seeded: SeededTask): ToolContext {
  return {
    workspaceId: seeded.workspaceId,
    threadId: 'th1',
    triggerId: 'tr1',
    text: '把 A 的结果交给 B',
    actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
    selection: {
      contextNodeIds: [],
      targetNodeId: seeded.nodeId,
      agentCandidates: [{ id: seeded.nodeId, title: 'agent', engine: 'fake' }],
    },
    policyVersion: 'p1',
    promptVersion: 'v1',
    memo: {},
  }
}

describe('createHandoffNode', () => {
  it('creates a text node next to the source agent and writes an audit', () => {
    const { root, database, seeded } = setup()
    addReview(database, seeded)

    const result = createHandoffNode(
      { db: database.db, workspacesRoot: root, now: () => 10, newId: () => 'handoff-1' },
      { taskId: seeded.taskId, workspaceId: seeded.workspaceId, actor: 'user' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.node.type).toBe('text')
    expect(result.node.canvasId).toBe(seeded.canvasId)
    expect(result.node.x).toBe(360)
    expect(textContent(result.node)).toContain('【交接】demo')
    expect(textContent(result.node)).toContain('已完成登录页改造')
    expect(textContent(result.node)).toContain('verify：exit 0')
    expect(textContent(result.node)).toContain('src/login.tsx')
    expect(textContent(result.node)).toContain('worktree="none"')
    const stored = getNode(database.db, 'handoff-1')
    expect(textContent(stored)).toContain('【交接】demo')

    const audit = database.raw
      .prepare("select action from audit where action = 'task.handoff.create'")
      .get() as { action: string } | undefined
    expect(audit?.action).toBe('task.handoff.create')
  })

  it('rejects an active task', () => {
    const { root, database, seeded } = setup({ status: 'running' })
    addReview(database, seeded)

    const result = createHandoffNode(
      { db: database.db, workspacesRoot: root, now: () => 10, newId: () => 'handoff-1' },
      { taskId: seeded.taskId, workspaceId: seeded.workspaceId, actor: 'user' },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('handoff_invalid')
  })

  it('rejects a task with no session or review', () => {
    const root = mkdtempSync(join(tmpdir(), 'baton-handoff-'))
    dirs.push(root)
    const database = createTestDb()
    dbs.push(database)
    const seeded = seedTask(database.raw, { taskStatus: 'cancelled', withSession: false })
    mkdirSync(join(root, seeded.relPath), { recursive: true })

    const result = createHandoffNode(
      { db: database.db, workspacesRoot: root, now: () => 10, newId: () => 'handoff-1' },
      { taskId: seeded.taskId, workspaceId: seeded.workspaceId, actor: 'user' },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('handoff_no_result')
  })

  it('hides a task from another workspace', () => {
    const { root, database, seeded } = setup()
    addReview(database, seeded)

    const result = createHandoffNode(
      { db: database.db, workspacesRoot: root, now: () => 10, newId: () => 'handoff-1' },
      { taskId: seeded.taskId, workspaceId: 'other-workspace', actor: 'user' },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('task_not_found')
  })

  it('marks a worktree source as unreadable and keeps the branch name', () => {
    const { root, database, seeded } = setup()
    addReview(database, seeded)
    database.raw
      .prepare("update task set workspace_mode = 'worktree', branch = ? where id = ?")
      .run('baton/demo', seeded.taskId)

    const result = createHandoffNode(
      { db: database.db, workspacesRoot: root, now: () => 10, newId: () => 'handoff-1' },
      { taskId: seeded.taskId, workspaceId: seeded.workspaceId, actor: 'user' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(textContent(result.node)).toContain('worktree="unreadable"')
    expect(textContent(result.node)).toContain('分支 baton/demo')
    expect(textContent(result.node)).toContain('变更文件在主工作区不可读')
    expect(result.summary.warnings).toEqual(['源任务在隔离 worktree，变更文件在主工作区不可读。'])
  })
})

describe('supervisor handoff_task', () => {
  function buildTools(database: TestDb, root: string) {
    const taskService = createTaskService({
      db: database.db,
      config: config(root),
      now: () => 10,
      newId: () => 'task-handoff',
    })
    let handoffSeq = 0
    return createSupervisorTools({
      db: database.db,
      workspacesRoot: root,
      claudeMaxBudgetUsd: 2,
      taskService,
      now: () => 10,
      newId: () => (handoffSeq++ === 0 ? 'handoff-node' : `handoff-extra-${handoffSeq}`),
      defaultEngine: 'claude-sdk',
      enqueueTask: () => ({ ok: true, status: 'queued' }),
      applyTransition: (taskId) => ({
        ok: true,
        taskId,
        status: 'cancelled',
        previousStatus: 'review',
        retryCount: 0,
        waitingReason: null,
        events: [],
      }),
      replyToTask: () => ({ ok: true }),
      injectContext: () => ({
        ok: true,
        taskId: 'unused',
        seq: 1,
        truncated: false,
        dropped: 0,
      }),
      cancelTask: (taskId) => ({
        ok: true,
        taskId,
        status: 'cancelled',
        previousStatus: 'review',
        retryCount: 0,
        waitingReason: null,
        events: [],
      }),
    })
  }

  it('creates a handoff node and a new todo task without a context edge', async () => {
    const { root, database, seeded } = setup()
    addReview(database, seeded)
    const tools = buildTools(database, root)

    const result = (await tools.handoff_task.execute(
      { fromTaskId: seeded.taskId, note: '继续修改登录页' },
      toolContext(seeded),
    )) as {
      task: { taskId: string; status: string }
      handoff: { nodeId: string; fromTaskId: string; warnings: string[] }
    }

    expect(result.task.status).toBe('todo')
    expect(result.handoff.fromTaskId).toBe(seeded.taskId)
    expect(result.handoff.nodeId).toBe('handoff-node')
    expect(result.handoff.warnings).toEqual([])

    const task = database.raw
      .prepare('select status, prompt, context_json, node_id from task where id = ?')
      .get('task-handoff') as {
      status: string
      prompt: string
      context_json: string
      node_id: string
    }
    expect(task.status).toBe('todo')
    expect(task.prompt).toContain('<task>继续修改登录页</task>')
    expect(task.prompt).toContain('【交接】demo')
    expect(task.prompt).toContain('已完成登录页改造')
    expect(task.node_id).toBe(seeded.nodeId)
    expect(task.context_json).toContain('handoff-node')

    const edgeCount = database.raw.prepare('select count(*) as count from edge').get() as {
      count: number
    }
    expect(edgeCount.count).toBe(0)

    const audit = database.raw
      .prepare("select detail_json from audit where action = 'supervisor.task.handoff'")
      .get() as { detail_json: string } | undefined
    expect(audit).toBeDefined()
    if (!audit) return
    const detail = JSON.parse(audit.detail_json) as Record<string, unknown>
    expect(detail).toMatchObject({
      fromTaskId: seeded.taskId,
      toTaskId: 'task-handoff',
      nodeId: 'handoff-node',
      hasNote: true,
      started: false,
    })
  })
})

describe('supervisor tool surface', () => {
  it('matches the policy whitelist', () => {
    const { root, database } = setup()
    const tools = buildToolsForSurface(database, root)
    expect(Object.keys(tools).sort()).toEqual([...SUPERVISOR_POLICY.allowedTools].sort())
  })
})

function buildToolsForSurface(database: TestDb, root: string) {
  return createSupervisorTools({
    db: database.db,
    workspacesRoot: root,
    claudeMaxBudgetUsd: 2,
    taskService: createTaskService({
      db: database.db,
      config: config(root),
      now: () => 10,
      newId: () => 'task-surface',
    }),
    now: () => 10,
    newId: () => 'node-surface',
    defaultEngine: 'claude-sdk',
    enqueueTask: () => ({ ok: true, status: 'queued' }),
    applyTransition: (taskId) => ({
      ok: true,
      taskId,
      status: 'cancelled',
      previousStatus: 'review',
      retryCount: 0,
      waitingReason: null,
      events: [],
    }),
    replyToTask: () => ({ ok: true }),
    injectContext: () => ({ ok: true, taskId: 'unused', seq: 1, truncated: false, dropped: 0 }),
    cancelTask: (taskId) => ({
      ok: true,
      taskId,
      status: 'cancelled',
      previousStatus: 'review',
      retryCount: 0,
      waitingReason: null,
      events: [],
    }),
  })
}
