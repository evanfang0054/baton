import type { AgentAdapter, AgentEvent, AgentRun } from '@baton/protocol'
import { EventType, PolicySchema } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { createEventStore } from '../src/db/event-store.js'
import { listApprovalsByTask, updateApprovalResponse } from '../src/db/repositories.js'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'
import { createSessionRunner } from '../src/runtime/session-runner.js'
import type { TransitionOutcome } from '../src/runtime/types.js'
import { waitFor } from './helpers/async.js'
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
        answerQuestion: async () => {},
        send: async () => {},
        interrupt: async () => {},
        dispose: async () => {},
      }
    },
  }
}

function questionAdapter(
  replies: Array<{ requestId: string; answers: Record<string, string>; response?: string }>,
  denials: Array<{ requestId: string; decision: string; note?: string }> = [],
): AgentAdapter {
  return {
    name: 'fake',
    async start(): Promise<AgentRun> {
      let release!: () => void
      const answered = new Promise<void>((resolve) => {
        release = resolve
      })
      const events = (async function* (): AsyncGenerator<AgentEvent> {
        yield { type: EventType.RUN_STARTED, threadId: 'thread-1', runId: 'run-1' } as AgentEvent
        yield {
          type: EventType.CUSTOM,
          name: 'approval.request',
          value: {
            requestId: 'req-q',
            request: {
              toolName: 'AskUserQuestion',
              risk: 'high',
              input: {
                questions: [
                  {
                    question: '用哪个方案？',
                    header: '方案',
                    multiSelect: false,
                    options: [
                      { label: '方案 A', description: '改动小' },
                      { label: '方案 B', description: '重构彻底' },
                    ],
                  },
                ],
              },
            },
          },
        } as AgentEvent
        await answered
        yield { type: EventType.RUN_FINISHED, threadId: 'thread-1', runId: 'run-1' } as AgentEvent
      })()
      return {
        events,
        approve: async (requestId, decision, note) => {
          denials.push({ requestId, decision, ...(note ? { note } : {}) })
          release()
        },
        answerQuestion: async (requestId, answers, response) => {
          replies.push({ requestId, answers, ...(response ? { response } : {}) })
          release()
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
      killSwitch: () => false,
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
      bypassPermissions: false,
    })
    await runner.close()

    expect(approvals).toEqual([{ requestId: 'req-1', decision: 'deny' }])
    expect(transitions).toContain('approval_requested')
    database.raw.close()
  })

  it('dispatches stored question answers through answerQuestion', async () => {
    const database = createTestDb()
    const seeded = seedTask(database.raw)
    const replies: Array<{
      requestId: string
      answers: Record<string, string>
      response?: string
    }> = []
    let id = 0
    const eventStore = createEventStore(database.db, {
      now: () => 1,
      newId: () => `event-${++id}`,
    })
    const runner = createSessionRunner({
      db: database.db,
      adapters: createAdapterFactory({ fake: questionAdapter(replies) }),
      eventStore,
      broadcast: () => {},
      killSwitch: () => false,
      applyTransition: (_taskId, event): TransitionOutcome => {
        if (event.type === 'approval_requested') {
          return {
            ok: true,
            taskId: seeded.taskId,
            status: 'waiting_input',
            previousStatus: 'running',
            retryCount: 0,
            waitingReason: 'approval',
            events: [],
          }
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
      bypassPermissions: false,
    })
    await waitFor(() => listApprovalsByTask(database.db, seeded.taskId).length === 1)
    const approval = listApprovalsByTask(database.db, seeded.taskId)[0]!
    database.db.transaction((tx) =>
      updateApprovalResponse(tx, approval.id, {
        answers: { '用哪个方案？': '方案 A' },
        response: '就 A',
      }),
    )

    await runner.approve(approval.id, 'allow')
    await waitFor(() => replies.length === 1)
    expect(replies).toEqual([
      { requestId: 'req-q', answers: { '用哪个方案？': '方案 A' }, response: '就 A' },
    ])

    await runner.close()
    database.raw.close()
  })

  it('denies the question when no stored answer exists', async () => {
    const database = createTestDb()
    const seeded = seedTask(database.raw)
    const replies: Array<{
      requestId: string
      answers: Record<string, string>
      response?: string
    }> = []
    const denials: Array<{ requestId: string; decision: string; note?: string }> = []
    let id = 0
    const eventStore = createEventStore(database.db, {
      now: () => 1,
      newId: () => `event-${++id}`,
    })
    const runner = createSessionRunner({
      db: database.db,
      adapters: createAdapterFactory({ fake: questionAdapter(replies, denials) }),
      eventStore,
      broadcast: () => {},
      killSwitch: () => false,
      applyTransition: (_taskId, event): TransitionOutcome => ({
        ok: true,
        taskId: seeded.taskId,
        status: event.type === 'approval_requested' ? 'waiting_input' : 'running',
        previousStatus: 'running',
        retryCount: 0,
        waitingReason: event.type === 'approval_requested' ? 'approval' : null,
        events: [],
      }),
      now: () => 1,
      newId: () => `id-${++id}`,
    })

    await runner.start({
      taskId: seeded.taskId,
      sessionId: seeded.sessionId!,
      workspacePath: '.',
      policy: PolicySchema.parse({}),
      workspaceTrust: { projectSettings: false, projectHooks: false },
      bypassPermissions: false,
    })
    await waitFor(() => listApprovalsByTask(database.db, seeded.taskId).length === 1)
    const approval = listApprovalsByTask(database.db, seeded.taskId)[0]!

    await runner.approve(approval.id, 'allow')
    await waitFor(() => denials.length === 1)
    expect(denials).toEqual([
      { requestId: 'req-q', decision: 'deny', note: 'question answers missing' },
    ])
    expect(replies).toEqual([])

    await runner.close()
    database.raw.close()
  })
})
