import type { AgentAdapter, AgentEvent, AgentRun } from '@baton/protocol'
import { EventType, PolicySchema } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { createEventStore } from '../src/db/event-store.js'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'
import { createSessionRunner } from '../src/runtime/session-runner.js'
import type { TransitionOutcome } from '../src/runtime/types.js'
import { createTestDb, seedTask } from './helpers/db.js'

function approvalAdapter(approvals: Array<{ requestId: string; decision: string }>): AgentAdapter {
  return {
    name: 'fake',
    async start(): Promise<AgentRun> {
      const events = (async function* (): AsyncGenerator<AgentEvent> {
        yield { type: EventType.RUN_STARTED, threadId: 'thread-1', runId: 'run-1' } as AgentEvent
        yield {
          type: EventType.CUSTOM,
          name: 'approval.request',
          value: {
            requestId: 'req-1',
            request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'high' },
          },
        } as AgentEvent
        yield { type: EventType.RUN_FINISHED, threadId: 'thread-1', runId: 'run-1' } as AgentEvent
      })()
      return {
        events,
        approve: async (requestId, decision) => {
          approvals.push({ requestId, decision })
        },
        send: async () => {},
        interrupt: async () => {},
        dispose: async () => {},
      }
    },
  }
}

describe('session runner approval failures', () => {
  it('denies the adapter when approval_requested transition fails', async () => {
    const database = createTestDb()
    const seeded = seedTask(database.raw)
    const approvals: Array<{ requestId: string; decision: string }> = []
    const transitions: string[] = []
    let id = 0
    const eventStore = createEventStore(database.db, {
      now: () => 1,
      newId: () => `event-${++id}`,
    })
    const runner = createSessionRunner({
      db: database.db,
      adapters: createAdapterFactory({ fake: approvalAdapter(approvals) }),
      eventStore,
      broadcast: () => {},
      applyTransition: (_taskId, event): TransitionOutcome => {
        transitions.push(event.type)
        if (event.type === 'approval_requested') {
          return { ok: false, error: { code: 'invalid_policy', message: 'workspace invalid' } }
        }
        return {
          ok: true,
          taskId: seeded.taskId,
          status: 'running',
          previousStatus: 'running',
          retryCount: 0,
          waitingReason: null,
          events: [],
        }
      },
      now: () => 1,
      newId: () => `id-${++id}`,
    })

    await runner.start({
      taskId: seeded.taskId,
      sessionId: seeded.sessionId!,
      workspacePath: '.',
      policy: PolicySchema.parse({}),
      workspaceTrust: { projectSettings: false, projectHooks: false },
    })
    await runner.close()

    expect(approvals).toEqual([{ requestId: 'req-1', decision: 'deny' }])
    expect(transitions).toContain('approval_requested')
    database.raw.close()
  })
})
