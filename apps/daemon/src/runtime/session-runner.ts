import { evaluateApproval } from '@baton/core'
import {
  ApprovalRequest,
  EventType,
  type AgentRun,
  type Policy,
  type TaskTransitionEvent,
} from '@baton/protocol'
import { z } from 'zod'
import type { BroadcastEvent, EventStore } from '../db/event-store.js'
import {
  getTask,
  insertApproval,
  insertAudit,
  updateApprovalDecision,
  updateSessionEngineId,
  updateSessionStatus,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError, toAppError } from '../errors.js'
import type { AdapterFactory } from './adapter-factory.js'
import type { StartSessionInput, TransitionOutcome } from './types.js'

const APPROVAL_REQUEST = 'approval.request'
const ApprovalValue = z.object({
  requestId: z.string().min(1),
  request: ApprovalRequest,
})

export interface SessionRunnerDeps {
  db: Db
  adapters: AdapterFactory
  eventStore: EventStore
  broadcast: (event: BroadcastEvent) => void
  applyTransition: (taskId: string, event: TaskTransitionEvent) => TransitionOutcome
  now: () => number
  newId: () => string
}

export interface ActiveRun {
  taskId: string
  sessionId: string
  run: AgentRun
  requestIdByApprovalId: Map<string, string>
}

export interface SessionRunner {
  start(input: StartSessionInput): Promise<void>
  interrupt(taskId: string): Promise<void>
  approve(approvalId: string, decision: 'allow' | 'deny', note?: string): Promise<void>
  dispose(): Promise<void>
}

export function createSessionRunner(deps: SessionRunnerDeps): SessionRunner {
  const activeRuns = new Map<string, ActiveRun>()

  function endSession(sessionId: string, status: 'ended' | 'failed'): void {
    deps.db.transaction((tx) => updateSessionStatus(tx, sessionId, status, deps.now()))
  }

  function failTask(taskId: string, sessionId: string, error: unknown): void {
    const appError = toAppError(error)
    deps.applyTransition(taskId, { type: 'error', message: appError.message })
    endSession(sessionId, 'failed')
  }

  async function handleApproval(active: ActiveRun, policy: Policy, value: unknown): Promise<void> {
    const parsed = ApprovalValue.safeParse(value)
    if (!parsed.success) {
      deps.applyTransition(active.taskId, {
        type: 'error',
        message: 'invalid approval request',
      })
      return
    }

    const { requestId, request } = parsed.data
    const approvalId = deps.newId()
    deps.db.transaction((tx) =>
      insertApproval(tx, {
        id: approvalId,
        sessionId: active.sessionId,
        requestId,
        request,
      }),
    )

    const decision = evaluateApproval(policy, request, { killSwitch: false })
    const autoDecision = decision.decision
    if (autoDecision === 'allow' || autoDecision === 'deny') {
      deps.db.transaction((tx) =>
        updateApprovalDecision(tx, approvalId, autoDecision, 'auto', deps.now()),
      )
      deps.db.transaction((tx) =>
        insertAudit(tx, {
          id: deps.newId(),
          ts: deps.now(),
          actor: 'auto',
          action: autoDecision === 'allow' ? 'approval.auto_allow' : 'approval.auto_deny',
          detail: {
            approvalId,
            taskId: active.taskId,
            risk: decision.risk,
            matchedRule: decision.matchedRule,
          },
        }),
      )
      await active.run.approve(requestId, autoDecision)
      return
    }

    active.requestIdByApprovalId.set(approvalId, requestId)
    const outcome = deps.applyTransition(active.taskId, {
      type: 'approval_requested',
      approvalId,
    })
    if (!outcome.ok) {
      active.requestIdByApprovalId.delete(approvalId)
      deps.db.transaction((tx) =>
        updateApprovalDecision(tx, approvalId, 'deny', 'system', deps.now()),
      )
      deps.db.transaction((tx) =>
        insertAudit(tx, {
          id: deps.newId(),
          ts: deps.now(),
          actor: 'system',
          action: 'approval.expired',
          detail: { approvalId, taskId: active.taskId },
        }),
      )
    }
  }

  async function consume(active: ActiveRun, policy: Policy): Promise<void> {
    let seq = 0
    let finished = false
    try {
      for await (const event of active.run.events) {
        const current = getTask(deps.db, active.taskId)
        if (
          !current ||
          current.status === 'cancelled' ||
          current.status === 'done' ||
          current.status === 'failed'
        ) {
          break
        }

        seq += 1
        const wsEvent = deps.eventStore.appendSessionEvent({
          sessionId: active.sessionId,
          seq,
          event,
          ts: deps.now(),
        })
        deps.broadcast(wsEvent)

        if (event.type === EventType.RUN_STARTED) {
          deps.db.transaction((tx) => updateSessionEngineId(tx, active.sessionId, event.threadId))
        } else if (event.type === EventType.CUSTOM && event.name === APPROVAL_REQUEST) {
          await handleApproval(active, policy, event.value)
        } else if (event.type === EventType.RUN_FINISHED) {
          finished = true
          deps.applyTransition(active.taskId, { type: 'completed' })
          endSession(active.sessionId, 'ended')
          break
        } else if (event.type === EventType.RUN_ERROR) {
          finished = true
          deps.applyTransition(active.taskId, {
            type: 'error',
            message: event.message ?? 'run failed',
          })
          endSession(active.sessionId, 'failed')
          break
        }
      }

      if (!finished) {
        const current = getTask(deps.db, active.taskId)
        if (current && (current.status === 'running' || current.status === 'waiting_input')) {
          deps.applyTransition(active.taskId, {
            type: 'error',
            message: 'adapter stream ended unexpectedly',
          })
          endSession(active.sessionId, 'failed')
        } else if (current?.status === 'cancelled') {
          endSession(active.sessionId, 'ended')
        }
      }
    } catch (error) {
      const current = getTask(deps.db, active.taskId)
      if (current && (current.status === 'running' || current.status === 'waiting_input')) {
        deps.applyTransition(active.taskId, {
          type: 'error',
          message: toAppError(error).message,
        })
      }
      endSession(active.sessionId, 'failed')
    } finally {
      activeRuns.delete(active.sessionId)
      await active.run.dispose().catch(() => {})
    }
  }

  async function start(input: StartSessionInput): Promise<void> {
    const task = getTask(deps.db, input.taskId)
    if (!task) return

    let run: AgentRun
    try {
      const adapter = deps.adapters(task.engine)
      run = await adapter.start({
        prompt: task.prompt,
        cwd: input.workspacePath,
        permissionMode: 'manual',
        policy: input.policy,
      })
    } catch (error) {
      failTask(task.id, input.sessionId, error)
      return
    }

    const active: ActiveRun = {
      taskId: task.id,
      sessionId: input.sessionId,
      run,
      requestIdByApprovalId: new Map(),
    }
    activeRuns.set(input.sessionId, active)
    void consume(active, input.policy)
  }

  async function approve(
    approvalId: string,
    decision: 'allow' | 'deny',
    note?: string,
  ): Promise<void> {
    for (const active of activeRuns.values()) {
      const requestId = active.requestIdByApprovalId.get(approvalId)
      if (!requestId) continue
      active.requestIdByApprovalId.delete(approvalId)
      await active.run.approve(requestId, decision, note)
      return
    }
    throw appError('approval_expired', 'approval is no longer active', { approvalId })
  }

  async function interrupt(taskId: string): Promise<void> {
    for (const active of activeRuns.values()) {
      if (active.taskId !== taskId) continue
      await active.run.interrupt().catch(() => {})
      return
    }
  }

  async function dispose(): Promise<void> {
    const runs = [...activeRuns.values()]
    activeRuns.clear()
    for (const active of runs) {
      await active.run.dispose().catch(() => {})
    }
  }

  return { start, interrupt, approve, dispose }
}
