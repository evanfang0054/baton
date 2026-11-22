import { ScriptedAdapter } from './helpers/scripted-adapter.js'
import type { StartInput } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { getTask } from '../src/db/repositories.js'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'
import { createTestRuntime } from './helpers/runtime.js'

function setup(script: ConstructorParameters<typeof ScriptedAdapter>[0] = {}) {
  const seen: StartInput[] = []
  const scripted = new ScriptedAdapter(script)
  const handle = createTestRuntime({
    useSessionRunner: true,
    adapters: createAdapterFactory({
      'claude-sdk': {
        name: 'claude-sdk',
        start: (input) => {
          seen.push(input)
          return scripted.start(input)
        },
      },
    }),
  })
  return { handle, seen }
}

describe('budget start guard', () => {
  it('passes the remaining budget to the adapter', async () => {
    const { handle, seen } = setup({
      script: [{ kind: 'usage', costUsd: 0.5 }, { kind: 'finish' }],
    })
    const taskId = handle.createTask({ budgetUsd: 2 })
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await handle.runtime.settle()

    expect(seen).toHaveLength(1)
    expect(seen[0]?.maxBudgetUsd).toBe(2)
    expect(getTask(handle.database.db, taskId)?.budgetUsd).toBe(2)
    await handle.cleanup()
  })

  it('refuses to start when the budget is already exhausted', async () => {
    const { handle, seen } = setup()
    const taskId = handle.createTask({ budgetUsd: 2 })
    handle.database.raw
      .prepare(
        `insert into session (id, task_id, adapter, status, cost_usd, turns, started_at, ended_at)
         values ('spent-session', ?, 'claude-sdk', 'ended', 2.5, 3, 1, 2)`,
      )
      .run(taskId)

    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    handle.runtime.applyTransition(taskId, { type: 'start' })
    await handle.runtime.settle()

    expect(seen).toHaveLength(0)
    expect(getTask(handle.database.db, taskId)).toMatchObject({
      status: 'waiting_input',
      waitingReason: 'budget',
    })
    await handle.cleanup()
  })
})
