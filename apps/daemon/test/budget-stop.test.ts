import { FakeAdapter } from '@baton/adapters'
import type { AgentRun, StartInput } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { getTask } from '../src/db/repositories.js'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'
import { createTestRuntime } from './helpers/runtime.js'

function setup(script: ConstructorParameters<typeof FakeAdapter>[0]) {
  const interrupts: string[] = []
  let seq = 0
  const fake = new FakeAdapter(script)
  const handle = createTestRuntime({
    useSessionRunner: true,
    adapters: createAdapterFactory({
      fake: {
        name: 'fake',
        start: async (input: StartInput): Promise<AgentRun> => {
          const run = await fake.start(input)
          const id = `run-${++seq}`
          return {
            ...run,
            interrupt: async () => {
              interrupts.push(id)
              await run.interrupt()
            },
          }
        },
      },
    }),
  })
  return { handle, interrupts }
}

describe('budget stop', () => {
  it('stops at 100% and keeps the workspace', async () => {
    const { handle, interrupts } = setup({
      script: [{ kind: 'usage', costUsd: 2, turns: 1 }, { kind: 'finish' }],
    })
    const taskId = handle.createTask({ budgetUsd: 2 })
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await handle.runtime.settle()

    expect(getTask(handle.database.db, taskId)).toMatchObject({
      status: 'waiting_input',
      waitingReason: 'budget',
    })
    expect(interrupts.length).toBeGreaterThan(0)
    await handle.cleanup()
  })

  it('maps SDK budget errors to budget_exceeded', async () => {
    const { handle } = setup({
      script: [{ kind: 'error', message: 'Exceeded USD budget' }],
    })
    const taskId = handle.createTask({ budgetUsd: 0.1 })
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await handle.runtime.settle()

    expect(getTask(handle.database.db, taskId)).toMatchObject({
      status: 'waiting_input',
      waitingReason: 'budget',
    })
    await handle.cleanup()
  })
})
