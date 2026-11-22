import { afterEach, describe, expect, it } from 'vitest'
import { createSupervisorTools } from '../src/supervisor/tools.js'
import { createTestDb, seedTask, seedTextNode, type TestDb } from './helpers/db.js'

const dbs: TestDb[] = []
afterEach(() => dbs.splice(0).forEach((entry) => entry.raw.close()))

function setup() {
  const database = createTestDb()
  dbs.push(database)
  const seeded = seedTask(database.raw, { taskStatus: 'todo' })
  seedTextNode(database.raw, seeded.canvasId, 'text-1', '需求 A')
  database.raw
    .prepare(
      `insert into task (
         id, workspace_id, node_id, title, prompt, status, engine, workspace_mode,
         retry_count, dangerously_skip_permissions, created_at, updated_at
       ) values ('running-1', ?, ?, '运行中', 'p', 'running', 'fake', 'main', 0, 0, 1, 1)`,
    )
    .run(seeded.workspaceId, seeded.nodeId)
  const cancelled: string[] = []
  let createCalls = 0
  const tools = createSupervisorTools({
    db: database.db,
    workspacesRoot: '/tmp',
    claudeMaxBudgetUsd: 2,
    taskService: {
      createTask: () => {
        createCalls += 1
        return { ok: false, error: { code: 'unused', message: 'unused' } }
      },
    } as never,
    now: () => 1,
    newId: () => 'id',
    defaultEngine: 'fake',
    enqueueTask: () => ({ ok: false, error: { code: 'unused', message: 'unused' } as never }),
    applyTransition: () => ({
      ok: false,
      error: { code: 'unused', message: 'unused' } as never,
    }),
    replyToTask: () => ({ ok: false }),
    injectContext: () => ({
      ok: false,
      error: { code: 'unused', message: 'unused' } as never,
    }),
    cancelTask: (taskId) => {
      cancelled.push(taskId)
      return {
        ok: true,
        taskId,
        status: 'cancelled',
        previousStatus: 'todo',
        retryCount: 0,
        waitingReason: null,
        events: [],
      }
    },
    actions: {
      propose: () => ({ ok: false, error: { code: 'unused', message: 'unused' } }),
      decide: () => ({ ok: false, error: { code: 'unused', message: 'unused' } }),
      get: () => null,
      listProposed: () => [],
    } as never,
    contextDigest: () => [],
  })
  const ctx = {
    workspaceId: seeded.workspaceId,
    threadId: 'th1',
    triggerId: 'trigger-1',
    text: '取消这些任务',
    actor: { id: 'local-user', kind: 'human' as const, source: 'supervisor-chat' as const },
    selection: { contextNodeIds: [], agentCandidates: [] },
    policyVersion: 'p1',
    promptVersion: 'v1',
    memo: {},
  }
  return { database, seeded, tools, ctx, cancelled, createCalls: () => createCalls }
}

describe('batch_tasks', () => {
  it('dry-runs cancel, keeps running out, and executes only after confirm', async () => {
    const { seeded, tools, ctx, cancelled } = setup()
    const preview = (await tools.batch_tasks.execute(
      { action: 'cancel', taskIds: [seeded.taskId, 'running-1'], dryRun: true },
      ctx,
    )) as { dryRun: boolean; requiresConfirmation: boolean; items: Array<{ taskId: string }> }
    expect(preview.dryRun).toBe(true)
    expect(preview.requiresConfirmation).toBe(true)
    expect(preview.items.map((item) => item.taskId)).toEqual([seeded.taskId])
    expect(cancelled).toEqual([])

    const executed = (await tools.batch_tasks.execute(
      { action: 'cancel', taskIds: [seeded.taskId, 'running-1'], dryRun: false, confirm: true },
      ctx,
    )) as { dryRun: boolean; items: Array<{ taskId: string; ok: boolean }> }
    expect(executed.dryRun).toBe(false)
    expect(executed.items).toEqual([{ taskId: seeded.taskId, ok: true }])
    expect(cancelled).toEqual([seeded.taskId])
  })

  it('create_tasks dryRun previews without creating a task', async () => {
    const { seeded, tools, ctx, createCalls } = setup()
    const preview = (await tools.create_tasks.execute(
      { nodeIds: ['text-1'], targetNodeId: seeded.nodeId, dryRun: true },
      ctx,
    )) as { dryRun: boolean; items: Array<{ title: string }> }
    expect(preview.dryRun).toBe(true)
    expect(preview.items[0]?.title).toBe('需求 A')
    expect(createCalls()).toBe(0)
  })
})
