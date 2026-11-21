import type { AgentAdapter, AgentEvent, AgentRun, Policy } from '@baton/protocol'
import { EventType, PolicySchema } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { createEventStore } from '../src/db/event-store.js'
import { listApprovalsByTask, listAudit } from '../src/db/repositories.js'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'
import { createSessionRunner } from '../src/runtime/session-runner.js'
import { waitFor } from './helpers/async.js'
import { createTestDb, seedTask } from './helpers/db.js'

function approvalBurstAdapter(count: number, decisions: string[]): AgentAdapter {
  return {
    name: 'fake',
    async start(): Promise<AgentRun> {
      let closed = false
      const gates = Array.from({ length: count }, () => {
        let release!: () => void
        const promise = new Promise<void>((resolve) => {
          release = resolve
        })
        return { promise, release }
      })
      const releaseAll = () => gates.forEach((gate) => gate.release())
      const events = (async function* (): AsyncGenerator<AgentEvent> {
        yield { type: EventType.RUN_STARTED, threadId: 'thread-1', runId: 'run-1' } as AgentEvent
        for (let index = 0; index < count; index += 1) {
          if (closed) break
          yield {
            type: EventType.CUSTOM,
            name: 'approval.request',
            value: {
              requestId: `req-${index + 1}`,
              request: {
                toolName: 'Bash',
                input: { command: 'pnpm test' },
                risk: 'medium',
              },
            },
          } as AgentEvent
          await gates[index]!.promise
        }
        yield { type: EventType.RUN_FINISHED, threadId: 'thread-1', runId: 'run-1' } as AgentEvent
      })()
      return {
        events,
        approve: async (requestId, decision) => {
          decisions.push(decision)
          const index = Number(requestId.split('-')[1]) - 1
          gates[index]?.release()
        },
        answerQuestion: async () => {},
        send: async () => {},
        interrupt: async () => {
          closed = true
          releaseAll()
        },
        dispose: async () => {
          closed = true
          releaseAll()
        },
      }
    },
  }
}

function delegatedPolicy(maxAutoApprovalsPerTask: number): Policy {
  return PolicySchema.parse({
    autopilot: { enabled: true, delegatedAuthority: true, maxAutoApprovalsPerTask },
  })
}

function setup(count: number, cap: number) {
  const database = createTestDb()
  const seeded = seedTask(database.raw, { trusted: true })
  database.raw.prepare('update task set origin_json = ? where id = ?').run(
    JSON.stringify({
      source: 'supervisor-chat',
      triggerId: 'trigger-1',
      threadId: 'thread-1',
      actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
      workspaceId: seeded.workspaceId,
      targetNodeId: seeded.nodeId,
      contextNodeIds: [],
      policyVersion: 'p1',
      promptVersion: 'v1',
      createdAt: 1,
    }),
    seeded.taskId,
  )
  const decisions: string[] = []
  let id = 0
  const eventStore = createEventStore(database.db, {
    now: () => 1,
    newId: () => `event-${++id}`,
  })
  const runner = createSessionRunner({
    db: database.db,
    dataDir: process.cwd(),
    claudeMaxBudgetUsd: 2,
    adapters: createAdapterFactory({ fake: approvalBurstAdapter(count, decisions) }),
    eventStore,
    broadcast: () => {},
    killSwitch: () => false,
    applyTransition: (taskId, event) => ({
      ok: true,
      taskId,
      status: event.type === 'approval_requested' ? 'waiting_input' : 'running',
      previousStatus: 'running',
      retryCount: 0,
      waitingReason: event.type === 'approval_requested' ? 'approval' : null,
      events: [],
    }),
    now: () => 1,
    newId: () => `id-${++id}`,
  })
  return { database, seeded, decisions, runner, cap }
}

async function start(handle: ReturnType<typeof setup>, policy: Policy): Promise<void> {
  await handle.runner.start({
    taskId: handle.seeded.taskId,
    sessionId: handle.seeded.sessionId!,
    workspacePath: '.',
    policy,
    workspaceTrust: { projectSettings: false, projectHooks: false },
    bypassPermissions: false,
  })
}

describe('approval cap', () => {
  it('auto-approves 10 then falls back to human', async () => {
    const handle = setup(11, 10)
    await start(handle, delegatedPolicy(10))

    await waitFor(
      () => listApprovalsByTask(handle.database.db, handle.seeded.taskId).length === 11,
      2000,
    )
    const approvals = listApprovalsByTask(handle.database.db, handle.seeded.taskId)
    expect(approvals.filter((item) => item.decidedBy === 'auto')).toHaveLength(10)
    expect(approvals.filter((item) => item.decision === null)).toHaveLength(1)
    expect(handle.decisions).toHaveLength(10)

    const capAudits = listAudit(handle.database.db, {
      actionPrefix: 'approval.cap_reached',
      limit: 10,
    })
    expect(capAudits).toHaveLength(1)
    expect(capAudits[0]?.detail).toMatchObject({
      taskId: handle.seeded.taskId,
      count: 10,
      cap: 10,
    })
    await handle.runner.close()
    handle.database.raw.close()
  })

  it('cap 0 disables auto approval', async () => {
    const handle = setup(1, 0)
    await start(handle, delegatedPolicy(0))

    await waitFor(
      () => listApprovalsByTask(handle.database.db, handle.seeded.taskId).length === 1,
      2000,
    )
    const approvals = listApprovalsByTask(handle.database.db, handle.seeded.taskId)
    expect(approvals[0]).toMatchObject({ decision: null, decidedBy: null })
    expect(handle.decisions).toEqual([])
    expect(
      listAudit(handle.database.db, { actionPrefix: 'approval.cap_reached', limit: 10 }),
    ).toHaveLength(1)
    await handle.runner.close()
    handle.database.raw.close()
  })
})
