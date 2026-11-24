import { afterEach, describe, expect, it } from 'vitest'
import { createSupervisorActionService } from '../src/supervisor/actions.js'
import { createSupervisorTools } from '../src/supervisor/tools.js'
import { createTestDb, seedTask, seedTextNode, type TestDb } from './helpers/db.js'

const dbs: TestDb[] = []
afterEach(() => dbs.splice(0).forEach((entry) => entry.raw.close()))

describe('plan_tasks', () => {
  it('writes one proposed triage_plan and creates no task', async () => {
    const database = createTestDb()
    dbs.push(database)
    const seeded = seedTask(database.raw, { trusted: true })
    seedTextNode(database.raw, seeded.canvasId, 'text-1', '修复登录页')
    let now = 1_000
    const actions = createSupervisorActionService({
      db: database.db,
      now: () => now++,
      newId: (() => {
        let index = 0
        return () => `a-${++index}`
      })(),
      policyVersion: () => 'p1',
      requireMandate: () => null,
      applyTransition: () => ({
        ok: false,
        error: { code: 'unused', message: 'unused' } as never,
      }),
      enqueueTask: () => ({ ok: false, error: { code: 'unused', message: 'unused' } as never }),
      generateDigest: () => null,
    })
    const tools = createSupervisorTools({
      db: database.db,
      workspacesRoot: '/tmp',
      taskService: {
        createTask: () => ({ ok: false, error: { code: 'unused', message: 'unused' } as never }),
      } as never,
      now: () => now++,
      newId: () => 'id',
      defaultEngine: 'claude-sdk',
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
      cancelTask: () => ({ ok: false, error: { code: 'unused', message: 'unused' } as never }),
      actions,
      contextDigest: () => [],
    })
    const result = (await tools.plan_tasks.execute(
      {
        source: { nodeIds: ['text-1'] },
        template: 'bugfix',
        maxItems: 3,
      },
      {
        workspaceId: seeded.workspaceId,
        threadId: 'th1',
        triggerId: 'trigger-1',
        text: '修复登录页',
        actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
        selection: { contextNodeIds: [], agentCandidates: [] },
        deliveryId: null,
        stageKey: null,
        allowWorkspaceCanvas: true,
        policyVersion: 'p1',
        promptVersion: 'v1',
        memo: {},
      },
    )) as { actionId: string; status: string; plan: { items: unknown[] } }
    expect(result.status).toBe('proposed')
    expect(result.plan.items).toHaveLength(1)
    expect(actions.listProposed(seeded.workspaceId)).toHaveLength(1)
    expect(database.raw.prepare('select count(*) as count from task').get()).toEqual({ count: 1 })
  })
})
