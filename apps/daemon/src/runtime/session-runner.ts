import { autoApprovalCapReached, evaluateApproval } from '@baton/core'
import {
  APPROVAL_REQUEST_EVENT,
  ApprovalRequestValue,
  EventType,
  SESSION_OUTCOME_EVENT,
  SESSION_USAGE_EVENT,
  SessionOutcomeValue,
  SessionUsageValue,
  USER_MESSAGE_EVENT,
  type AgentRun,
  type Policy,
  type SessionOutcome,
  type TaskTransitionEvent,
} from '@baton/protocol'
import type { BroadcastEvent, EventStore } from '../db/event-store.js'
import { getTaskBudgetState } from '../budget/service.js'
import { formatBudgetResume, pendingBudgetResume } from './budget-command.js'
import {
  countAutoApprovals,
  getApproval,
  getTask,
  getTaskDetail,
  getWorkspace,
  insertApproval,
  insertAudit,
  updateApprovalDecision,
  updateSessionEngineId,
  updateSessionStatus,
  updateSessionUsage,
  updateTaskWorktreePath,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError, toAppError } from '../errors.js'
import { writeEscapesWorkspace } from '../workspace/safety.js'
import { createWorktree, removeWorktree } from '../workspace/worktree.js'
import { hashPolicy } from '../automation/version.js'
import type { AdapterFactory } from './adapter-factory.js'
import { ASK_USER_QUESTION_TOOL, parseStoredAnswers, validateQuestionAnswers } from './questions.js'
import type { StartSessionInput, TransitionOutcome } from './types.js'

const VERIFIER_READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])
const VERIFIER_SAFE_GIT =
  /^git(\s+-C\s+\S+)?\s+(status|diff|log|show|rev-parse|ls-files|worktree\s+list)\b/
const VERIFIER_SAFE_READ = /^(ls|cat|head|tail|wc|stat|grep|rg|od|which|pwd)\b/
const VERIFIER_SAFE_RUN = /^(node\s+(--version|-v)|pnpm\s+(test|lint|typecheck|build))\b/
// 这些参数能把“只读”命令变成写文件或执行子进程。
const VERIFIER_DENY_FLAGS =
  /(^|\s)(--output|--ext-diff|--pre)(=|\s|$)|(^|\s)-(delete|exec|execdir|ok|okdir|fprint0?|fls)(\s|$)/

function isBudgetError(message: string): boolean {
  return /budget|maxBudget|cost limit|USD budget/i.test(message)
}

/**
 * 验收员只应读；总管全权不能让它获得任意 Bash。
 * 这里只给只读工具和安全只读命令放行，其他请求仍走正常 policy/人工闸门。
 */
export function isReadOnlyVerifierRequest(request: { toolName: string; input: unknown }): boolean {
  if (VERIFIER_READ_TOOLS.has(request.toolName)) return true
  if (request.toolName !== 'Bash') return false
  const command =
    typeof request.input === 'object' && request.input !== null
      ? (request.input as { command?: unknown }).command
      : undefined
  if (typeof command !== 'string') return false
  const withoutAnd = command.replaceAll('&&', ' ')
  if (/[;&|><\n\r`]|\$\(/.test(withoutAnd)) return false
  if (VERIFIER_DENY_FLAGS.test(command)) return false
  const segments = command
    .split('&&')
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (segments.length === 0) return false
  return segments.every(
    (segment) =>
      VERIFIER_SAFE_GIT.test(segment) ||
      VERIFIER_SAFE_READ.test(segment) ||
      VERIFIER_SAFE_RUN.test(segment),
  )
}

export interface SessionRunnerDeps {
  db: Db
  dataDir: string
  claudeMaxBudgetUsd: number
  adapters: AdapterFactory
  eventStore: EventStore
  broadcast: (event: BroadcastEvent) => void
  applyTransition: (taskId: string, event: TaskTransitionEvent) => TransitionOutcome
  now: () => number
  newId: () => string
  killSwitch: () => boolean
}

export interface ActiveRun {
  taskId: string
  sessionId: string
  workspacePath: string
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

    // 每次审批都读当前 trust：撤销信任后必须立即回到 ask，不能沿用启动快照。
    const task = getTask(deps.db, active.taskId)
    const workspace = task ? getWorkspace(deps.db, task.workspaceId) : null
    const taskDetail = task ? getTaskDetail(deps.db, task.id) : null
    // 总管派发的任务（含它派出的验收员）才可能获得 workspace 的委派授权；人工任务永远走人工闸门。
    const originSource = taskDetail?.task.origin?.source
    const delegatedAuthority =
      originSource === 'supervisor-chat' ||
      (originSource === 'supervisor-review' && isReadOnlyVerifierRequest(request))
    // 结构化提问不能被策略自动放行：没有答案的 allow 会让 SDK 停在 pending。
    // 先跑策略，保证 deny 永远优先；symlink 逃逸只能把 allow/ask 降级为人工确认。
    const evaluated =
      request.toolName === ASK_USER_QUESTION_TOOL
        ? null
        : evaluateApproval(policy, request, {
            killSwitch: deps.killSwitch(),
            workspaceTrusted: workspace?.trusted === true,
            delegatedAuthority,
          })
    const escapes =
      evaluated !== null &&
      evaluated.decision !== 'deny' &&
      writeEscapesWorkspace(active.workspacePath, request.toolName, request.input)
    const decision =
      evaluated === null
        ? null
        : escapes
          ? {
              ...evaluated,
              decision: 'ask' as const,
              risk: 'high' as const,
              autoApproved: false,
              reason: 'write escapes workspace via symlink',
            }
          : evaluated
    if (decision !== null && (decision.decision === 'allow' || decision.decision === 'deny')) {
      const autoDecision = decision.decision
      const autoCount = autoDecision === 'allow' ? countAutoApprovals(deps.db, active.taskId) : 0
      if (
        autoDecision === 'allow' &&
        autoApprovalCapReached({
          count: autoCount,
          cap: policy.autopilot.maxAutoApprovalsPerTask,
        })
      ) {
        // 到达上限后不再自动放行，转人工审批；deny 仍然优先且不受上限影响。
        deps.db.transaction((tx) =>
          insertAudit(tx, {
            id: deps.newId(),
            ts: deps.now(),
            actor: 'auto',
            action: 'approval.cap_reached',
            detail: {
              taskId: active.taskId,
              approvalId,
              count: autoCount,
              cap: policy.autopilot.maxAutoApprovalsPerTask,
            },
          }),
        )
      } else {
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
              policyVersion: hashPolicy(policy),
            },
          })
        })
        await active.run.approve(requestId, autoDecision)
        return
      }
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
        } else if (event.type === EventType.CUSTOM && event.name === SESSION_USAGE_EVENT) {
          const parsed = SessionUsageValue.safeParse(event.value)
          if (parsed.success) {
            deps.db.transaction((tx) =>
              updateSessionUsage(tx, active.sessionId, {
                ...(parsed.data.costUsd !== undefined ? { costUsd: parsed.data.costUsd } : {}),
                ...(parsed.data.turns !== undefined ? { turns: parsed.data.turns } : {}),
              }),
            )
            const budget = getTaskBudgetState(deps.db, active.taskId, {
              claudeMaxBudgetUsd: deps.claudeMaxBudgetUsd,
            })
            if (budget?.overBudget) {
              const current = getTask(deps.db, active.taskId)
              if (current?.status === 'running') {
                deps.applyTransition(active.taskId, { type: 'budget_exceeded' })
                await active.run.interrupt().catch(() => {})
                break
              }
            }
          }
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
          const message = event.message ?? 'run failed'
          if (isBudgetError(message)) {
            deps.applyTransition(active.taskId, { type: 'budget_exceeded' })
            endSession(active.sessionId, 'ended')
          } else {
            deps.applyTransition(active.taskId, { type: 'error', message })
            endSession(active.sessionId, 'failed')
          }
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
          // 预算耗尽是我们主动停下的，不是适配器异常退出。
          if (current.waitingReason === 'budget') {
            endSession(active.sessionId, 'ended')
          } else {
            deps.applyTransition(active.taskId, {
              type: 'error',
              message: 'adapter stream ended while waiting for input',
            })
            endSession(active.sessionId, 'failed')
          }
        } else if (current?.status === 'cancelled') {
          endSession(active.sessionId, 'ended')
        }
      }
    } catch (error) {
      const current = getTask(deps.db, active.taskId)
      const message = toAppError(error).message
      if (current && (current.status === 'running' || current.status === 'waiting_input')) {
        deps.applyTransition(
          active.taskId,
          isBudgetError(message) ? { type: 'budget_exceeded' } : { type: 'error', message },
        )
      }
      endSession(active.sessionId, isBudgetError(message) ? 'ended' : 'failed')
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

    const budget = getTaskBudgetState(deps.db, task.id, {
      claudeMaxBudgetUsd: deps.claudeMaxBudgetUsd,
    })
    if (budget?.overBudget) {
      const outcome = deps.applyTransition(task.id, { type: 'budget_exceeded' })
      endSession(input.sessionId, outcome.ok ? 'ended' : 'failed')
      return
    }
    const resumeNote = pendingBudgetResume(deps.db, task.id)
    const prompt = resumeNote ? `${task.prompt}\n\n${formatBudgetResume(resumeNote)}` : task.prompt

    let workspacePath = input.workspacePath
    if (task.workspaceMode === 'worktree') {
      let preparedPath: string | null = null
      let preparedCreated = false
      try {
        const prepared = await createWorktree({
          dataDir: deps.dataDir,
          workspacePath: input.workspacePath,
          taskId: task.id,
          existingPath: task.worktreePath,
          existingBranch: task.branch,
        })
        if (!prepared.ok) {
          failTask(task.id, input.sessionId, appError('worktree_unavailable', prepared.reason))
          return
        }
        preparedPath = prepared.path
        preparedCreated = prepared.created
        workspacePath = prepared.path
        if (task.worktreePath !== prepared.path || task.branch !== prepared.branch) {
          updateTaskWorktreePath(deps.db, task.id, prepared.path, deps.now(), prepared.branch)
        }
      } catch {
        // 创建或落库失败都要把任务收敛到 failed；
        // 否则 afterCommit 只记日志，任务会永久停在 running。
        if (preparedPath && preparedCreated) {
          await removeWorktree({
            workspacePath: input.workspacePath,
            path: preparedPath,
          }).catch(() => {})
        }
        failTask(
          task.id,
          input.sessionId,
          appError('worktree_unavailable', 'worktree preparation failed'),
        )
        return
      }
    }

    let run: AgentRun
    try {
      const adapter = await deps.adapters(task.engine)
      run = await adapter.start({
        prompt,
        cwd: workspacePath,
        permissionMode: 'manual',
        policy: input.policy,
        workspaceTrust: input.workspaceTrust,
        bypassPermissions: input.bypassPermissions,
        ...(budget ? { maxBudgetUsd: budget.remainingUsd } : {}),
      })
    } catch (error) {
      failTask(task.id, input.sessionId, error)
      return
    }
    if (resumeNote) {
      deps.db.transaction((tx) =>
        insertAudit(tx, {
          id: deps.newId(),
          ts: deps.now(),
          actor: 'system',
          action: 'task.budget.resume',
          detail: { taskId: task.id, ...resumeNote },
        }),
      )
    }

    const active: ActiveRun = {
      taskId: task.id,
      sessionId: input.sessionId,
      workspacePath,
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
      const record = getApproval(deps.db, approvalId)
      if (record?.request.toolName === ASK_USER_QUESTION_TOOL && decision === 'allow') {
        const stored = parseStoredAnswers(record.response)
        const checked = stored
          ? validateQuestionAnswers(record.request, {
              decision: 'allow',
              answers: stored.answers,
              ...(stored.response ? { response: stored.response } : {}),
            })
          : null
        if (checked?.ok && checked.payload) {
          await active.run.answerQuestion(
            requestId,
            checked.payload.answers,
            checked.payload.response,
          )
          return
        }
        // 答案缺失时不能静默 allow：SDK 会停在无答案的 pending 上。
        await active.run.approve(requestId, 'deny', 'question answers missing')
        return
      }
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
