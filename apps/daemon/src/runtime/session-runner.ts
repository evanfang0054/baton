import { evaluateApproval } from '@baton/core'
import {
  APPROVAL_REQUEST_EVENT,
  ApprovalRequestValue,
  EventType,
  SESSION_OUTCOME_EVENT,
  SessionOutcomeValue,
  USER_MESSAGE_EVENT,
  type AgentRun,
  type Policy,
  type SessionOutcome,
  type TaskTransitionEvent,
} from '@baton/protocol'
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

export interface SessionRunnerDeps {
  db: Db
  adapters: AdapterFactory
  eventStore: EventStore
  broadcast: (event: BroadcastEvent) => void
  applyTransition: (taskId: string, event: TaskTransitionEvent) => TransitionOutcome
  now: () => number
  newId: () => string
  killSwitch?: boolean
}

export interface ActiveRun {
  taskId: string
  sessionId: string
  run: AgentRun
  requestIdByApprovalId: Map<string, string>
  seq: number
  outcome: SessionOutcome | null
  outcomeReason?: string
}

export interface SessionRunner {
  start(input: StartSessionInput): Promise<void>
  interrupt(taskId: string): Promise<void>
  approve(approvalId: string, decision: 'allow' | 'deny', note?: string): Promise<void>
  reply(taskId: string, text: string): Promise<void>
  has(taskId: string): boolean
  close(): Promise<void>
}

export function createSessionRunner(deps: SessionRunnerDeps): SessionRunner {
  const activeRuns = new Map<string, ActiveRun>()
  const running = new Set<Promise<void>>()

  function endSession(
    sessionId: string,
    status: 'ended' | 'failed',
    outcome: SessionOutcome | null = null,
  ): void {
    deps.db.transaction((tx) => updateSessionStatus(tx, sessionId, status, deps.now(), outcome))
  }

  function failTask(taskId: string, sessionId: string, error: unknown): void {
    const failure = toAppError(error)
    deps.applyTransition(taskId, { type: 'error', message: failure.message })
    endSession(sessionId, 'failed')
  }

  async function handleApproval(active: ActiveRun, policy: Policy, value: unknown): Promise<void> {
    const parsed = ApprovalRequestValue.safeParse(value)
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

    const decision = evaluateApproval(policy, request, { killSwitch: deps.killSwitch ?? false })
    const autoDecision = decision.decision
    if (autoDecision === 'allow' || autoDecision === 'deny') {
      // 决策与审计必须同事务提交，否则崩溃窗口会出现“已放行但无审计”。
      deps.db.transaction((tx) => {
        updateApprovalDecision(tx, approvalId, autoDecision, 'auto', deps.now())
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
        })
      })
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
      deps.db.transaction((tx) => {
        updateApprovalDecision(tx, approvalId, 'deny', 'system', deps.now())
        insertAudit(tx, {
          id: deps.newId(),
          ts: deps.now(),
          actor: 'system',
          action: 'approval.expired',
          detail: { approvalId, taskId: active.taskId },
        })
      })
      // 转移失败时适配器仍挂在 pending approval 上；必须回传 deny 让它继续或结束。
      try {
        await active.run.approve(requestId, 'deny')
      } catch {
        deps.applyTransition(active.taskId, {
          type: 'error',
          message: 'approval resolution failed',
        })
      }
    }
  }

  async function consume(active: ActiveRun, policy: Policy): Promise<void> {
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

        const seq = ++active.seq
        const wsEvent = deps.eventStore.appendSessionEvent({
          sessionId: active.sessionId,
          seq,
          event,
          ts: deps.now(),
        })
        deps.broadcast(wsEvent)

        if (event.type === EventType.RUN_STARTED) {
          deps.db.transaction((tx) => updateSessionEngineId(tx, active.sessionId, event.threadId))
        } else if (event.type === EventType.CUSTOM && event.name === APPROVAL_REQUEST_EVENT) {
          await handleApproval(active, policy, event.value)
        } else if (event.type === EventType.CUSTOM && event.name === SESSION_OUTCOME_EVENT) {
          const parsed = SessionOutcomeValue.safeParse(event.value)
          if (!parsed.success || active.outcome !== null) {
            deps.applyTransition(active.taskId, {
              type: 'error',
              message: 'invalid session outcome',
            })
            endSession(active.sessionId, 'failed')
            break
          }
          active.outcome = parsed.data.outcome
          if (parsed.data.reason) {
            active.outcomeReason = parsed.data.reason
          }

          if (parsed.data.outcome === 'blocked' || parsed.data.outcome === 'dropped') {
            const outcome = deps.applyTransition(active.taskId, {
              type: 'session_reported',
              outcome: parsed.data.outcome,
              ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
            })
            if (!outcome.ok) {
              endSession(active.sessionId, 'failed')
              break
            }
            deps.db.transaction((tx) =>
              updateSessionStatus(tx, active.sessionId, 'waiting_input', null, null),
            )
            // 不 break：run 仍然活着，等待 session.reply 调 send。
          }
        } else if (event.type === EventType.RUN_FINISHED) {
          finished = true
          if (active.outcome === 'ready') {
            const outcome = deps.applyTransition(active.taskId, { type: 'completed' })
            endSession(
              active.sessionId,
              outcome.ok ? 'ended' : 'failed',
              outcome.ok ? 'ready' : null,
            )
          } else if (active.outcome === 'blocked' || active.outcome === 'dropped') {
            deps.applyTransition(active.taskId, {
              type: 'error',
              message: `RUN_FINISHED after ${active.outcome} outcome`,
            })
            endSession(active.sessionId, 'failed')
          } else {
            deps.applyTransition(active.taskId, {
              type: 'session_reported',
              outcome: 'unreported',
            })
            endSession(active.sessionId, 'ended', 'unreported')
          }
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
        if (current?.status === 'running') {
          const outcome = deps.applyTransition(active.taskId, {
            type: 'session_reported',
            outcome: 'unreported',
          })
          endSession(
            active.sessionId,
            outcome.ok ? 'ended' : 'failed',
            outcome.ok ? 'unreported' : null,
          )
        } else if (current?.status === 'waiting_input') {
          deps.applyTransition(active.taskId, {
            type: 'error',
            message: 'adapter stream ended while waiting for input',
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
    if (!task) {
      return
    }

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
      seq: 0,
      outcome: null,
    }
    activeRuns.set(input.sessionId, active)
    const promise = consume(active, input.policy)
    running.add(promise)
    void promise.finally(() => running.delete(promise))
  }

  async function approve(
    approvalId: string,
    decision: 'allow' | 'deny',
    note?: string,
  ): Promise<void> {
    for (const active of activeRuns.values()) {
      const requestId = active.requestIdByApprovalId.get(approvalId)
      if (!requestId) {
        continue
      }
      active.requestIdByApprovalId.delete(approvalId)
      await active.run.approve(requestId, decision, note)
      return
    }
    throw appError('approval_expired', 'approval is no longer active', { approvalId })
  }

  function findByTask(taskId: string): ActiveRun | undefined {
    return [...activeRuns.values()].find((run) => run.taskId === taskId)
  }

  async function interrupt(taskId: string): Promise<void> {
    const active = findByTask(taskId)
    if (!active) {
      return
    }
    await active.run.interrupt().catch(() => {})
  }

  async function reply(taskId: string, text: string): Promise<void> {
    const active = findByTask(taskId)
    if (!active) {
      throw appError('session_not_active', 'no active session for task', { taskId })
    }
    if (active.outcome !== 'blocked' && active.outcome !== 'dropped') {
      throw appError('reply_not_allowed', 'session is not waiting for a reply', {
        taskId,
        outcome: active.outcome,
      })
    }

    active.outcome = null
    active.outcomeReason = undefined
    deps.db.transaction((tx) => updateSessionStatus(tx, active.sessionId, 'running', null, null))

    const seq = ++active.seq
    const wsEvent = deps.eventStore.appendSessionEvent({
      sessionId: active.sessionId,
      seq,
      event: { type: EventType.CUSTOM, name: USER_MESSAGE_EVENT, value: { text } },
      ts: deps.now(),
    })
    deps.broadcast(wsEvent)

    try {
      await active.run.send(text)
    } catch (error) {
      deps.applyTransition(taskId, { type: 'error', message: toAppError(error).message })
      endSession(active.sessionId, 'failed')
      activeRuns.delete(active.sessionId)
      await active.run.dispose().catch(() => {})
      throw error
    }
  }

  function has(taskId: string): boolean {
    return findByTask(taskId) !== undefined
  }

  async function close(): Promise<void> {
    const runs = [...activeRuns.values()]
    activeRuns.clear()
    for (const active of runs) {
      await active.run.dispose().catch(() => {})
    }
    // 等 consume 收敛，避免 close 返回后仍有事件写库。
    await Promise.all([...running])
  }

  return { start, interrupt, approve, reply, has, close }
}
