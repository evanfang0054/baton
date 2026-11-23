import { afterEach, describe, expect, it } from 'vitest'
import { loadWorkspacePolicy } from '../src/supervisor/autonomy.js'
import { createTestRuntime, type TestRuntimeHandle } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

describe('plan apply', () => {
  it('is human-only, idempotent, and reports partial failures', async () => {
    const handle = createTestRuntime({ trusted: true })
    handles.push(handle)
    const policyVersion = loadWorkspacePolicy(
      handle.database.db,
      handle.config,
      handle.seeded.workspaceId,
    )!.policyVersion
    const proposed = handle.runtime.actions.propose({
      workspaceId: handle.seeded.workspaceId,
      threadId: 'th1',
      taskId: null,
      kind: 'triage_plan',
      strength: 'inferred',
      mode: 'observe',
      reason: '计划',
      payload: {
        triggerId: 'trigger-1',
        source: { nodeIds: ['text-1'] },
        templateId: 'bugfix',
        contextDigest: [],
        items: [
          {
            title: '修复登录',
            templateId: 'bugfix',
            targetNodeId: null,
            agentTitle: 'Agent 1',
            contextNodeIds: [],
            engine: 'claude-sdk',
          },
          {
            title: '目标已失效',
            templateId: null,
            targetNodeId: 'missing-node',
            agentTitle: null,
            contextNodeIds: [],
            engine: 'claude-sdk',
          },
        ],
      },
      policyVersion,
      dedupeKey: 'plan:apply:1',
    })
    if (!proposed.ok) throw new Error(proposed.error.message)

    const applied = handle.runtime.handleCommand({
      v: 1,
      id: 'p1',
      ts: 1,
      type: 'supervisor.action.decide',
      payload: {
        workspaceId: handle.seeded.workspaceId,
        actionId: proposed.action.id,
        decision: 'apply',
      },
    })
    expect(applied.ok).toBe(true)
    const stored = handle.runtime.actions.get(proposed.action.id)
    expect(stored?.status).toBe('applied')
    const result = stored?.result as {
      createdTaskIds: string[]
      failed: Array<{ index: number }>
    }
    expect(result.createdTaskIds).toHaveLength(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.index).toBe(1)

    const created = handle.database.raw
      .prepare('select status, origin_json from task where id = ?')
      .get(result.createdTaskIds[0]!) as { status: string; origin_json: string }
    expect(created.status).toBe('todo')
    expect(JSON.parse(created.origin_json)).toMatchObject({
      templateId: 'bugfix',
      acceptanceSeed: ['复现步骤可执行', '失败现象消失', '相关回归点通过'],
    })

    const again = handle.runtime.handleCommand({
      v: 1,
      id: 'p2',
      ts: 1,
      type: 'supervisor.action.decide',
      payload: {
        workspaceId: handle.seeded.workspaceId,
        actionId: proposed.action.id,
        decision: 'apply',
      },
    })
    expect(again.ok).toBe(true)
    expect(handle.database.raw.prepare('select count(*) as count from task').get()).toEqual({
      count: 2,
    })
  })

  it('refuses a plan whose target no longer exists', async () => {
    const handle = createTestRuntime({ trusted: true })
    handles.push(handle)
    const policyVersion = loadWorkspacePolicy(
      handle.database.db,
      handle.config,
      handle.seeded.workspaceId,
    )!.policyVersion
    const proposed = handle.runtime.actions.propose({
      workspaceId: handle.seeded.workspaceId,
      threadId: 'th1',
      taskId: null,
      kind: 'triage_plan',
      strength: 'inferred',
      mode: 'observe',
      reason: '计划',
      payload: {
        triggerId: 'trigger-2',
        source: { nodeIds: ['text-1'] },
        templateId: null,
        contextDigest: [],
        items: [
          {
            title: '目标已失效',
            templateId: null,
            targetNodeId: 'missing-node',
            agentTitle: null,
            contextNodeIds: [],
            engine: null,
          },
        ],
      },
      policyVersion,
      dedupeKey: 'plan:apply:missing',
    })
    if (!proposed.ok) throw new Error(proposed.error.message)

    const decided = handle.runtime.handleCommand({
      v: 1,
      id: 'p3',
      ts: 1,
      type: 'supervisor.action.decide',
      payload: {
        workspaceId: handle.seeded.workspaceId,
        actionId: proposed.action.id,
        decision: 'apply',
      },
    })
    expect(decided).toMatchObject({ ok: false, error: { code: 'action_not_applicable' } })
    expect(handle.runtime.actions.get(proposed.action.id)?.status).toBe('failed')
    expect(handle.database.raw.prepare('select count(*) as count from task').get()).toEqual({
      count: 1,
    })
  })
})
