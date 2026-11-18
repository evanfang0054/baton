import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getTask } from '../src/db/repositories.js'
import { createTaskService } from '../src/runtime/task-service.js'
import type { SupervisorEngine } from '../src/supervisor/engine.js'
import { createSupervisorService } from '../src/supervisor/service.js'
import { createTestDb, seedTask, seedTextNode, type TestDb } from './helpers/db.js'

const dirs: string[] = []
const dbs: TestDb[] = []

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dbs.splice(0).forEach((entry) => entry.raw.close())
})

function setup(engine: SupervisorEngine) {
  const root = mkdtempSync(join(tmpdir(), 'baton-svc-'))
  dirs.push(root)
  const database = createTestDb()
  dbs.push(database)
  const seeded = seedTask(database.raw, { withSession: false })
  seedTextNode(database.raw, seeded.canvasId, 'text-1', '需求 A')
  mkdirSync(join(root, seeded.relPath), { recursive: true })
  writeFileSync(
    join(root, 'supervisor.json'),
    JSON.stringify({ baseUrl: 'https://example.com/v1', apiKey: 'sk-test', model: 'demo' }),
  )
  const config = {
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
  const taskService = createTaskService({
    db: database.db,
    config,
    now: () => 10,
    newId: () => 'task-new',
  })
  const frames: string[] = []
  let sequence = 0
  const service = createSupervisorService({
    db: database.db,
    dataDir: root,
    taskService,
    engine,
    now: () => 10,
    newId: () => `id-${++sequence}`,
    broadcastRaw: (frame) => frames.push(frame),
    track: (action) => {
      void action()
    },
    logger: { warn() {}, error() {}, info() {} } as never,
  })
  return { database, seeded, service, frames }
}

describe('supervisor service', () => {
  it('acks, streams, creates a todo task and dedupes the trigger', async () => {
    const engine: SupervisorEngine = {
      async run({ onDelta, tools }) {
        onDelta('正在建任务')
        const result = await tools.create_task.execute({
          title: '登录页暗黑模式',
          contextNodeIds: ['text-1'],
        })
        return {
          text: '已建到待办',
          toolCalls: [{ id: 'tc1', name: 'create_task', args: {}, ok: true, result }],
          finishReason: 'stop',
        }
      },
    }
    const { database, seeded, service, frames } = setup(engine)
    const input = {
      workspaceId: seeded.workspaceId,
      requestId: 'r1',
      text: '给这个 Agent 建个任务',
      contextNodeIds: ['text-1'],
      targetNodeId: seeded.nodeId,
    }
    const ack = service.send(input)
    expect(ack.ok).toBe(true)
    await service.waitForIdle()

    expect(frames.some((frame) => frame.includes('supervisor.delta'))).toBe(true)
    expect(frames.some((frame) => frame.includes('supervisor.tool'))).toBe(true)
    expect(frames.some((frame) => frame.includes('supervisor.message'))).toBe(true)
    expect(getTask(database.db, 'task-new')?.status).toBe('todo')
    expect(service.history(seeded.workspaceId, 50).messages.map((message) => message.role)).toEqual(
      ['user', 'assistant'],
    )

    const duplicate = service.send({ ...input, requestId: 'r1' })
    await service.waitForIdle()
    expect(duplicate.ok).toBe(true)
    // seedTask 已有一条占位任务；重复 requestId 不应再建第二条新任务。
    expect(database.raw.prepare('select count(*) as n from task').get()).toEqual({ n: 2 })
  })

  it('records an error message when the engine throws', async () => {
    const engine: SupervisorEngine = {
      async run() {
        throw new Error('provider down')
      },
    }
    const { database, seeded, service } = setup(engine)
    service.send({
      workspaceId: seeded.workspaceId,
      requestId: 'r2',
      text: '你好',
      contextNodeIds: [],
    })
    await service.waitForIdle()
    const row = database.raw
      .prepare("select status from supervisor_message where role='assistant'")
      .get() as { status: string }
    expect(row.status).toBe('error')
  })
})
