import type { TaskCreateInput } from '@baton/protocol'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../../src/config.js'
import type { BroadcastEvent } from '../../src/db/event-store.js'
import { createAdapterFactory, type AdapterFactory } from '../../src/runtime/adapter-factory.js'
import { createEngineRegistry, type EngineRegistry } from '../../src/runtime/engines.js'
import { createRuntime, type Runtime } from '../../src/runtime/index.js'
import type { StartSessionInput } from '../../src/runtime/types.js'
import { createTestDb, seedTask, type SeededTask, type TestDb } from './db.js'

export interface TestRuntimeHandle {
  runtime: Runtime
  database: TestDb
  seeded: SeededTask
  root: string
  config: Config
  engines: EngineRegistry
  now: () => number
  newId: () => string
  events: BroadcastEvent[]
  startSessions: StartSessionInput[]
  interrupts: string[]
  approvals: Array<{ approvalId: string; decision: 'allow' | 'deny'; note?: string }>
  verifies: string[]
  createTask(overrides?: Partial<TaskCreateInput>): string
  cleanup(): Promise<void>
}

export function createTestRuntime(
  options: {
    maxConcurrency?: number
    useSessionRunner?: boolean
    useVerifyRunner?: boolean
    adapters?: AdapterFactory
    config?: Partial<Config>
    broadcast?: (event: BroadcastEvent) => void
    engines?: EngineRegistry
  } = {},
): TestRuntimeHandle {
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
    maxLiveSessions: 5,
    claudeMaxTurns: 30,
    claudeMaxBudgetUsd: 2,
    claudeProjectHooks: 'on',
    allowBypassPermissions: false,
    killSwitch: false,
    ...options.config,
  }

  const events: BroadcastEvent[] = []
  const startSessions: StartSessionInput[] = []
  const interrupts: string[] = []
  const approvals: Array<{ approvalId: string; decision: 'allow' | 'deny'; note?: string }> = []
  const verifies: string[] = []
  let tick = 1
  let id = 0
  const now = (): number => tick++
  const newId = (): string => `id-${++id}`

  const engines =
    options.engines ??
    createEngineRegistry({
      env: {},
      home: root,
      sdkMeta: () => ({ available: true, version: 'test' }),
    })

  const runtime = createRuntime({
    db: database.db,
    config,
    engines,
    broadcast:
      options.broadcast ??
      ((event) => {
        events.push(event)
      }),
    ...(options.useSessionRunner
      ? {
          adapters: options.adapters ?? createAdapterFactory(),
          ...(options.useVerifyRunner
            ? {}
            : {
                runVerify: (taskId: string) => {
                  verifies.push(taskId)
                },
              }),
        }
      : {
          startSession: (input: StartSessionInput) => {
            startSessions.push(input)
          },
          interruptSession: (taskId: string) => {
            interrupts.push(taskId)
          },
          resolveApproval: (approvalId: string, decision: 'allow' | 'deny', note?: string) => {
            approvals.push({ approvalId, decision, ...(note ? { note } : {}) })
          },
          runVerify: (taskId: string) => {
            verifies.push(taskId)
          },
        }),
    now,
    newId,
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
      dangerouslySkipPermissions: false,
      ...overrides,
    }
    const result = runtime.createTask(input)
    if (!result.ok) {
      throw new Error(`createTask failed: ${result.error.code}`)
    }
    return result.taskId
  }

  return {
    runtime,
    database,
    seeded,
    root,
    config,
    engines,
    now,
    newId,
    events,
    startSessions,
    interrupts,
    approvals,
    verifies,
    createTask,
    cleanup: async () => {
      await runtime.close()
      database.raw.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}
