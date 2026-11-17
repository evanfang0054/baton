import type { TaskCreateInput } from '@baton/protocol'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../../src/config.js'
import type { BroadcastEvent } from '../../src/db/event-store.js'
import { createRuntime, type Runtime } from '../../src/runtime/index.js'
import type { StartSessionInput } from '../../src/runtime/types.js'
import { createTestDb, seedTask, type SeededTask, type TestDb } from './db.js'

export interface TestRuntimeHandle {
  runtime: Runtime
  database: TestDb
  seeded: SeededTask
  root: string
  events: BroadcastEvent[]
  startSessions: StartSessionInput[]
  interrupts: string[]
  approvals: Array<{ approvalId: string; decision: 'allow' | 'deny'; note?: string }>
  verifies: string[]
  createTask(overrides?: Partial<TaskCreateInput>): string
  cleanup(): void
}

export function createTestRuntime(options: { maxConcurrency?: number } = {}): TestRuntimeHandle {
  const root = mkdtempSync(join(tmpdir(), 'baton-runtime-'))
  const database = createTestDb()
  const seeded = seedTask(database.raw)
  mkdirSync(join(root, seeded.relPath), { recursive: true })
  database.raw
    .prepare(
      `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
       values ('text-1', ?, 'text', 10, 10, 320, 200, null, ?, 1, 1)`,
    )
    .run(seeded.canvasId, JSON.stringify({ content: '登录页需求' }))

  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    token: null,
    dataDir: root,
    webRoot: root,
    workspacesRoot: root,
    maxConcurrency: options.maxConcurrency ?? 1,
  }

  const events: BroadcastEvent[] = []
  const startSessions: StartSessionInput[] = []
  const interrupts: string[] = []
  const approvals: Array<{ approvalId: string; decision: 'allow' | 'deny'; note?: string }> = []
  const verifies: string[] = []
  let tick = 1
  let id = 0

  const runtime = createRuntime({
    db: database.db,
    config,
    broadcast: (event) => {
      events.push(event)
    },
    startSession: (input) => {
      startSessions.push(input)
    },
    interruptSession: (taskId) => {
      interrupts.push(taskId)
    },
    resolveApproval: (approvalId, decision, note) => {
      approvals.push({ approvalId, decision, ...(note ? { note } : {}) })
    },
    runVerify: (taskId) => {
      verifies.push(taskId)
    },
    now: () => tick++,
    newId: () => `id-${++id}`,
  })

  function createTask(overrides: Partial<TaskCreateInput> = {}): string {
    const input: TaskCreateInput = {
      workspaceId: seeded.workspaceId,
      nodeId: seeded.nodeId,
      title: 'demo',
      prompt: '把登录页改成暗黑模式',
      contextNodeIds: ['text-1'],
      engine: 'fake',
      workspaceMode: 'main',
      ...overrides,
    }
    const result = runtime.createTask(input)
    if (!result.ok) throw new Error(`createTask failed: ${result.error.code}`)
    return result.taskId
  }

  return {
    runtime,
    database,
    seeded,
    root,
    events,
    startSessions,
    interrupts,
    approvals,
    verifies,
    createTask,
    cleanup: () => {
      database.raw.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}
