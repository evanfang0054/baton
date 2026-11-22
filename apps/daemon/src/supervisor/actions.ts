import {
  ACTION_TTL_MS,
  PROPOSED_RETENTION_MS,
  TERMINAL_RETENTION_MS,
  canTransitionAction,
  isActionExpired,
} from '@baton/core'
import {
  SupervisorAction,
  type AppError,
  type Strength,
  type SupervisorActionKind,
  type TaskAction,
} from '@baton/protocol'
import { eq } from 'drizzle-orm'
import { insertAudit } from '../db/repositories.js'
import {
  deleteActionsBefore,
  findActionByDedupeKey,
  getActionRow,
  insertAction,
  listActionRows,
  listExpiredProposed,
} from '../db/supervisor-action-repository.js'
import { supervisorAction } from '../db/schema.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import type { TransitionOutcome } from '../runtime/types.js'
import type { EnqueueTaskResult } from './tools.js'

export interface SupervisorActionServiceDeps {
  db: Db
  now: () => number
  newId: () => string
  policyVersion: (workspaceId: string) => string
  requireMandate: (taskId: string, action: TaskAction, strength: Strength) => AppError | null
  applyTransition: (
    taskId: string,
    event: { type: 'retry' | 'reopen'; note?: string },
  ) => TransitionOutcome
  enqueueTask: (taskId: string) => EnqueueTaskResult
  generateDigest?: (workspaceId: string, trigger: 'attention') => unknown | null
}

export type ActionServiceResult<T> = ({ ok: true } & T) | { ok: false; error: AppError }

export interface ProposeActionInput {
  workspaceId: string
  threadId?: string | null
  taskId?: string | null
  kind: SupervisorActionKind
  strength: Strength
  mode: 'observe' | 'auto'
  reason: string
  payload: unknown
  policyVersion: string
  mandateVersion?: string | null
  dedupeKey: string
  expiresAt?: number
}

export function createSupervisorActionService(deps: SupervisorActionServiceDeps) {
  function propose(
    input: ProposeActionInput,
  ): ActionServiceResult<{ action: SupervisorAction; duplicate: boolean }> {
    const existing = findActionByDedupeKey(deps.db, input.dedupeKey)
    if (existing) return { ok: true, action: existing, duplicate: true }
    const now = deps.now()
    const action = SupervisorAction.parse({
      id: deps.newId(),
      workspaceId: input.workspaceId,
      threadId: input.threadId ?? null,
      taskId: input.taskId ?? null,
      kind: input.kind,
      status: 'proposed',
      strength: input.strength,
      mode: input.mode,
      reason: input.reason,
      payload: input.payload,
      result: null,
      policyVersion: input.policyVersion,
      mandateVersion: input.mandateVersion ?? null,
      dedupeKey: input.dedupeKey,
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt ?? now + ACTION_TTL_MS,
      appliedAt: null,
      ignoredAt: null,
    })
    try {
      deps.db.transaction((tx) => {
        insertAction(tx, action)
        insertAudit(tx, {
          id: deps.newId(),
          ts: now,
          actor: input.strength === 'inferred' ? 'supervisor' : 'human',
          action: 'supervisor.action.propose',
          detail: {
            actionId: action.id,
            workspaceId: action.workspaceId,
            taskId: action.taskId,
            kind: action.kind,
            mode: action.mode,
          },
        })
      })
    } catch {
      const raced = findActionByDedupeKey(deps.db, input.dedupeKey)
      if (raced) return { ok: true, action: raced, duplicate: true }
      return { ok: false, error: appError('action_write_failed', 'cannot write action') }
    }
    return { ok: true, action, duplicate: false }
  }

  function decide(input: {
    workspaceId: string
    actionId: string
    actor: 'human' | 'supervisor' | 'system'
    decision: 'apply' | 'ignore'
  }): ActionServiceResult<{ action: SupervisorAction }> {
    const action = getActionRow(deps.db, input.actionId)
    if (!action || action.workspaceId !== input.workspaceId) {
      return {
        ok: false,
        error: appError('action_not_found', 'action not found', { actionId: input.actionId }),
      }
    }
    if (action.status === 'applied' && input.decision === 'apply') {
      return { ok: true, action }
    }
    if (action.status === 'expired') {
      return {
        ok: false,
        error: appError('action_expired', 'action expired', { actionId: action.id }),
      }
    }
    if (action.status !== 'proposed') {
      return {
        ok: false,
        error: appError('action_already_decided', 'action already decided', {
          status: action.status,
        }),
      }
    }
    const now = deps.now()
    if (isActionExpired(action, now)) {
      updateStatus(action, 'expired', now, input.actor)
      return {
        ok: false,
        error: appError('action_expired', 'action expired', { actionId: action.id }),
      }
    }
    if (input.decision === 'apply' && input.actor === 'supervisor') {
      return {
        ok: false,
        error: appError('supervisor_action_forbidden', 'supervisor cannot apply actions'),
      }
    }
    if (input.decision === 'ignore') {
      return { ok: true, action: updateStatus(action, 'ignored', now, input.actor) }
    }
    if (action.policyVersion !== deps.policyVersion(action.workspaceId)) {
      return {
        ok: false,
        error: appError('action_not_applicable', 'policy changed since proposal'),
      }
    }
    const applied = applyAction(action, input.actor)
    if (!applied.ok) {
      updateStatus(action, 'failed', now, input.actor)
      return { ok: false, error: applied.error }
    }
    return {
      ok: true,
      action: updateStatus(action, 'applied', now, input.actor, applied.result),
    }
  }

  function applyAction(
    action: SupervisorAction,
    actor: 'human' | 'supervisor' | 'system',
  ): { ok: true; result: unknown } | { ok: false; error: AppError } {
    const payload = action.payload as { taskId?: string; note?: string }
    if (action.kind === 'attention_reminder') {
      deps.generateDigest?.(action.workspaceId, 'attention')
      return { ok: true, result: { generated: true } }
    }
    if (action.kind !== 'retry' && action.kind !== 'reopen') {
      return {
        ok: false,
        error: appError('action_not_applicable', 'action kind is not implemented in Plan A'),
      }
    }
    if (!payload.taskId) {
      return { ok: false, error: appError('action_not_applicable', 'action has no taskId') }
    }
    const mandate = deps.requireMandate(
      payload.taskId,
      action.kind,
      actor === 'system' ? action.strength : 'explicit',
    )
    if (mandate) return { ok: false, error: mandate }
    const outcome = deps.applyTransition(payload.taskId, {
      type: action.kind,
      ...(payload.note ? { note: payload.note } : {}),
    })
    if (!outcome.ok) return { ok: false, error: outcome.error }
    return { ok: true, result: { taskId: outcome.taskId, status: outcome.status } }
  }

  function updateStatus(
    action: SupervisorAction,
    status: 'applied' | 'ignored' | 'failed' | 'expired',
    now: number,
    actor: 'human' | 'supervisor' | 'system',
    result?: unknown,
  ): SupervisorAction {
    if (!canTransitionAction(action.status, status)) {
      throw appError('action_already_decided', 'illegal action transition', {
        status: action.status,
      })
    }
    deps.db.transaction((tx) => {
      tx.update(supervisorAction)
        .set({
          status,
          updatedAt: now,
          appliedAt: status === 'applied' ? now : action.appliedAt,
          ignoredAt: status === 'ignored' ? now : action.ignoredAt,
          ...(result === undefined ? {} : { resultJson: JSON.stringify(result) }),
        })
        .where(eq(supervisorAction.id, action.id))
        .run()
      insertAudit(tx, {
        id: deps.newId(),
        ts: now,
        actor,
        action: `supervisor.action.${status}`,
        detail: { actionId: action.id, workspaceId: action.workspaceId, kind: action.kind },
      })
    })
    return {
      ...action,
      status,
      updatedAt: now,
      appliedAt: status === 'applied' ? now : action.appliedAt,
      ignoredAt: status === 'ignored' ? now : action.ignoredAt,
      result: result === undefined ? action.result : result,
    }
  }

  function expire(): number {
    const now = deps.now()
    const rows = listExpiredProposed(deps.db, now)
    for (const action of rows) updateStatus(action, 'expired', now, 'system')
    return rows.length
  }

  function cleanup(): number {
    const now = deps.now()
    return deleteActionsBefore(deps.db, now - PROPOSED_RETENTION_MS, now - TERMINAL_RETENTION_MS)
  }

  return {
    propose,
    decide,
    expire,
    cleanup,
    get: (id: string) => getActionRow(deps.db, id),
    list: (workspaceId: string, status?: string, limit?: number) =>
      listActionRows(deps.db, {
        workspaceId,
        ...(status ? { status } : {}),
        ...(limit ? { limit } : {}),
      }),
    listProposed: (workspaceId: string) =>
      listActionRows(deps.db, { workspaceId, status: 'proposed' }),
  }
}
