import type Database from 'better-sqlite3'
import type { SessionStatus, TaskStatus } from '@baton/protocol'
import { randomUUID } from 'node:crypto'
import { createOrm, migrateDb, openDb } from '../../src/db/index.js'
import type { Db } from '../../src/db/types.js'

export interface TestDb {
  raw: Database.Database
  db: Db
}

export function createTestDb(): TestDb {
  const raw = openDb(':memory:')
  migrateDb(raw)
  return { raw, db: createOrm(raw) }
}

export function seedTextNode(
  raw: Database.Database,
  canvasId: string,
  id: string,
  content: string,
  x = 10,
  y = 10,
): void {
  raw
    .prepare(
      `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
       values (?, ?, 'text', ?, ?, 320, 200, null, ?, 1, 1)`,
    )
    .run(id, canvasId, x, y, JSON.stringify({ content }))
}

export interface SeededTask {
  workspaceId: string
  relPath: string
  canvasId: string
  nodeId: string
  taskId: string
  sessionId: string | null
}

export function seedTask(
  db: Database.Database,
  options: {
    taskStatus?: TaskStatus
    withSession?: boolean
    sessionStatus?: SessionStatus
    now?: number
    trusted?: boolean
  } = {},
): SeededTask {
  const now = options.now ?? 1
  const workspaceId = randomUUID()
  const relPath = `demo-${workspaceId}`
  const canvasId = randomUUID()
  const nodeId = randomUUID()
  const taskId = randomUUID()
  const sessionId = options.withSession === false ? null : randomUUID()

  db.prepare(
    'insert into workspace (id, name, rel_path, trusted, created_at) values (?, ?, ?, ?, ?)',
  ).run(workspaceId, 'demo', relPath, options.trusted === true ? 1 : 0, now)
  db.prepare('insert into canvas (id, workspace_id, viewport_json) values (?, ?, ?)').run(
    canvasId,
    workspaceId,
    JSON.stringify({ x: 0, y: 0, zoom: 1 }),
  )
  db.prepare(
    `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
     values (?, ?, 'agent', 0, 0, 320, 200, null, ?, ?, ?)`,
  ).run(
    nodeId,
    canvasId,
    JSON.stringify({ title: 'agent', engine: 'claude-sdk', taskId: null }),
    now,
    now,
  )
  db.prepare(
    `insert into task (
       id, workspace_id, node_id, title, prompt, status, engine, workspace_mode,
       branch, worktree_path, verify_command, retry_count, created_at, updated_at
     ) values (?, ?, ?, ?, ?, ?, 'claude-sdk', 'main', null, null, null, 0, ?, ?)`,
  ).run(
    taskId,
    workspaceId,
    nodeId,
    'demo',
    '<task>demo</task>',
    options.taskStatus ?? 'todo',
    now,
    now,
  )

  if (sessionId) {
    db.prepare(
      `insert into session (id, task_id, adapter, engine_session_id, status, started_at, ended_at)
       values (?, ?, 'claude-sdk', null, ?, ?, null)`,
    ).run(sessionId, taskId, options.sessionStatus ?? 'running', now)
  }

  return { workspaceId, relPath, canvasId, nodeId, taskId, sessionId }
}
