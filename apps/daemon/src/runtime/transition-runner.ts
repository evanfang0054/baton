import { transition } from '@baton/core'
import { PolicySchema, type TaskTransitionEvent } from '@baton/protocol'
import type { Config } from '../config.js'
import type { EventStore } from '../db/event-store.js'
import {
  type ApprovalRecord,
  countActiveTasks,
  getApproval,
  getTask,
  getWorkspace,
  updateTaskState,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError, toAppError } from '../errors.js'
import { loadPolicy } from '../workspace/policy.js'
import { resolveWorkspaceDir } from '../workspace/resolver.js'
import { planAndApplyEffects, type EffectPlan } from './effects.js'
import { isActiveStatus, type RuntimeHooks, type TransitionOutcome } from './types.js'

export interface TransitionRunnerDeps {
  db: Db
  config: Config
  eventStore: EventStore
  hooks: RuntimeHooks
  now: () => number
  newId: () => string
  verifyMeta: Map<string, number>
  killSwitch: () => boolean
}

function fail(code: string, message: string, details?: unknown): TransitionOutcome {
  return { ok: false, error: appError(code, message, details) }
}

const DEFAULT_POLICY = PolicySchema.parse({})

export function createTransitionRunner(deps: TransitionRunnerDeps) {
  function applyTransition(taskId: string, event: TaskTransitionEvent): TransitionOutcome {
    const task = getTask(deps.db, taskId)
    if (!task) {
      return fail('task_not_found', 'task not found', { taskId })
    }

    // 只有 start 需要 workspace/policy；verify_fail 需要 policy 的 autopilot。
    // error/cancel/enqueue 等不应因 workspace 缺失而无法收敛。
    let workspacePath = ''
    let policy = DEFAULT_POLICY
    let workspaceTrust = { projectSettings: false, projectHooks: false }
    let bypassPermissions = false
    const workspace = getWorkspace(deps.db, task.workspaceId)
    if (event.type === 'start') {
      if (!workspace) {
        return fail('workspace_not_found', 'workspace not found', {
          workspaceId: task.workspaceId,
        })
      }
      try {
        workspacePath = resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
        policy = loadPolicy(workspacePath)
        workspaceTrust = {
          projectSettings: workspace.trusted,
          projectHooks:
            workspace.trusted &&
            workspace.projectHooks === 'on' &&
            deps.config.claudeProjectHooks !== 'off',
        }
        bypassPermissions =
          task.dangerouslySkipPermissions && deps.config.allowBypassPermissions && workspace.trusted
      } catch (error) {
        return { ok: false, error: toAppError(error) }
      }
    } else if (event.type === 'verify_fail' && workspace) {
      try {
        policy = loadPolicy(resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath))
      } catch {
        policy = DEFAULT_POLICY
      }
    }

    const result = transition(
      {
        status: task.status,
        retryCount: task.retryCount,
        runningCount: countActiveTasks(deps.db),
        maxConcurrency: deps.config.maxConcurrency,
        autopilot: policy.autopilot,
        workspaceTrusted: workspace?.trusted === true,
        killSwitch: deps.killSwitch(),
        waitingReason: task.waitingReason,
      },
      event,
    )
    if (!result.ok) {
      return { ok: false, error: result.error }
    }

    let approval: ApprovalRecord | null = null
    if ('approvalId' in event) {
      approval = getApproval(deps.db, event.approvalId)
      if (!approval) {
        return fail('approval_not_found', 'approval not found', { approvalId: event.approvalId })
      }
    }

    const now = deps.now()
    let plan: EffectPlan
    try {
      plan = deps.db.transaction((tx) => {
        updateTaskState(tx, task.id, result.status, result.retryCount, result.waitingReason, now)
        return planAndApplyEffects(
          tx,
          {
            eventStore: deps.eventStore,
            hooks: deps.hooks,
            task,
            previousStatus: task.status,
            retryCount: result.retryCount,
            now,
            newId: deps.newId,
            workspacePath,
            policy,
            workspaceTrust,
            bypassPermissions,
            approval,
            verifyMeta: deps.verifyMeta,
          },
          result.effects,
        )
      })
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }

    for (const wsEvent of plan.events) {
      deps.hooks.broadcast(wsEvent)
    }
    for (const action of plan.afterCommit) {
      deps.hooks.track(action)
    }
    if (!isActiveStatus(result.status)) {
      deps.hooks.kick()
    }

    return {
      ok: true,
      taskId: task.id,
      status: result.status,
      previousStatus: task.status,
      retryCount: result.retryCount,
      waitingReason: result.waitingReason,
      events: plan.events,
    }
  }

  return { applyTransition }
}

export type TransitionRunner = ReturnType<typeof createTransitionRunner>
