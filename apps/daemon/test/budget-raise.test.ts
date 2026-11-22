import { ScriptedAdapter } from './helpers/scripted-adapter.js'
import type { AgentRun, StartInput } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { listAudit } from '../src/db/repositories.js'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'
import { createTestRuntime, type TestRuntimeHandle } from './helpers/runtime.js'

function setup() {
  const prompts: string[] = []
  const scripted = new ScriptedAdapter({ script: [{ kind: 'finish' }] })
  const handle = createTestRuntime({
    useSessionRunner: true,
    adapters: createAdapterFactory({
      'claude-sdk': {
        name: 'claude-sdk',
        start: async (input: StartInput): Promise<AgentRun> => {
          prompts.push(input.prompt)
          return scripted.start(input)
        },
      },
    }),
  })
  return { handle, prompts }
}

async function waitForBudget(handle: TestRuntimeHandle): Promise<string> {
  const taskId = handle.createTask({ budgetUsd: 2 })
  handle.database.raw
    .prepare(
      `insert into session (id, task_id, adapter, status, cost_usd, turns, started_at, ended_at)
       values (?, ?, 'claude-sdk', 'ended', 2, 2, 1, 2)`,
    )
    .run(`spent-${taskId}`, taskId)
  handle.runtime.applyTransition(taskId, { type: 'enqueue' })
  handle.runtime.applyTransition(taskId, { type: 'start' })
  await handle.runtime.settle()
  return taskId
}

describe('task.set_budget', () => {
  it('raises budget, queues a new run, and injects budget_resume once', async () => {
    const { handle, prompts } = setup()
    const taskId = await waitForBudget(handle)
    expect(handle.runtime.getTask(taskId)).toMatchObject({
      status: 'waiting_input',
      waitingReason: 'budget',
    })

    const result = handle.runtime.handleCommand({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'task.set_budget',
      payload: { taskId, budgetUsd: 3 },
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.ack).toMatchObject({ status: 'queued' })

    await handle.runtime.settle()
    const prompt = prompts.at(-1) ?? ''
    expect(prompt).toContain('<budget_resume previous_usd="2.00" budget_usd="3.00">')
    expect(handle.runtime.getTask(taskId)?.prompt).not.toContain('<budget_resume')

    const raises = listAudit(handle.database.db, {
      actionPrefix: 'task.budget.raise',
      limit: 10,
    })
    expect(raises).toHaveLength(1)
    const resumes = listAudit(handle.database.db, {
      actionPrefix: 'task.budget.resume',
      limit: 10,
    })
    expect(resumes).toHaveLength(1)
    await handle.cleanup()
  })

  it('rejects a budget below the amount already spent', async () => {
    const { handle } = setup()
    const taskId = await waitForBudget(handle)

    const result = handle.runtime.handleCommand({
      v: 1,
      id: 'c2',
      ts: 1,
      type: 'task.set_budget',
      payload: { taskId, budgetUsd: 1.5 },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('budget_below_spent')
    expect(handle.runtime.getTask(taskId)).toMatchObject({
      status: 'waiting_input',
      waitingReason: 'budget',
    })
    await handle.cleanup()
  })
})
