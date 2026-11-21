import {
  assembleContextInjection,
  buildContextUpdateBlock,
  canInjectContext,
  contextUpdateChars,
  cumulativeInjectedChars,
} from '@baton/core'
import type { AppError, ContextInjection, TaskDetail, TaskTransitionEvent } from '@baton/protocol'
import type { Config } from '../config.js'
import type { BroadcastEvent, EventStore } from '../db/event-store.js'
import {
  appendTaskContextInjection,
  appendTaskPromptRaw,
  getCanvasByWorkspace,
  getTaskDetail,
  getWorkspace,
  insertAudit,
  listEdges,
  listNodes,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import { buildContextContent } from '../workspace/context.js'
import { resolveWorkspaceDir } from '../workspace/resolver.js'
import type { TransitionOutcome } from './types.js'

export const MAX_CUMULATIVE_INJECTION_CHARS = 96_000
const MAX_PROMPT_BLOCK_CHARS = 96_000
const DEFAULT_NOTE = '补充以下上下文'

export interface ContextServiceDeps {
  db: Db
  config: Config
  eventStore: EventStore
  applyTransition(taskId: string, event: TaskTransitionEvent): TransitionOutcome
  hasSession(taskId: string): boolean
  broadcast(event: BroadcastEvent): void
  now(): number
  newId(): string
}

export interface InjectContextInput {
  taskId: string
  nodeIds: string[]
  note?: string
  source: 'user' | 'supervisor'
  actor: string
}

export type InjectContextResult =
  | { ok: true; taskId: string; seq: number; truncated: boolean; dropped: number }
  | { ok: false; error: AppError }

export interface PreparedContextInjection {
  ok: true
  task: TaskDetail
  injection: ContextInjection
  block: string
}

export function createContextService(deps: ContextServiceDeps) {
  function prepare(
    input: InjectContextInput,
    options: { allowReview?: boolean } = {},
  ): PreparedContextInjection | { ok: false; error: AppError } {
    const detail = getTaskDetail(deps.db, input.taskId)
    if (!detail) {
      return {
        ok: false,
        error: appError('task_not_found', 'task not found', { taskId: input.taskId }),
      }
    }
    if (detail.contextInvalid) {
      return {
        ok: false,
        error: appError('context_invalid', 'task context snapshot is invalid', {
          taskId: input.taskId,
        }),
      }
    }
    const task = detail.task
    const injectable = canInjectContext(task)
    const reviewAllowed = options.allowReview === true && task.status === 'review'
    if (!injectable.ok && !(reviewAllowed && injectable.reason === 'use_review_reject')) {
      return {
        ok: false,
        error: appError('task_not_injectable', 'task is not injectable', {
          taskId: task.id,
          status: task.status,
          reason: injectable.reason,
        }),
      }
    }
    if (task.status === 'review' && !reviewAllowed) {
      return {
        ok: false,
        error: appError('task_not_injectable', 'use review reject', {
          taskId: task.id,
          reason: 'use_review_reject',
        }),
      }
    }
    if (options.allowReview === true && task.status !== 'review') {
      return {
        ok: false,
        error: appError('task_not_injectable', 'allowReview is only valid for review tasks', {
          taskId: task.id,
          status: task.status,
        }),
      }
    }

    const workspace = getWorkspace(deps.db, task.workspaceId)
    if (!workspace) {
      return {
        ok: false,
        error: appError('workspace_not_found', 'workspace not found', {
          workspaceId: task.workspaceId,
        }),
      }
    }
    const canvas = getCanvasByWorkspace(deps.db, workspace.id)
    if (!canvas) {
      return {
        ok: false,
        error: appError('canvas_not_found', 'canvas not found', { workspaceId: workspace.id }),
      }
    }
    const nodes = listNodes(deps.db, canvas.id)
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const missing = input.nodeIds.filter((id) => !byId.has(id))
    if (missing.length > 0) {
      return {
        ok: false,
        error: appError('node_not_found', 'context node not found', { nodeIds: missing }),
      }
    }
    const invalid = input.nodeIds.filter((id) => {
      const node = byId.get(id)
      return node?.type === 'agent' || node?.type === 'review'
    })
    if (invalid.length > 0) {
      return {
        ok: false,
        error: appError('node_type_not_injectable', 'node type is not injectable', {
          nodeIds: invalid,
        }),
      }
    }

    const workspacePath = resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
    const { contentByNodeId } = buildContextContent({ nodes, workspacePath })
    const assembled = assembleContextInjection({
      selectedNodeIds: input.nodeIds,
      nodes,
      edges: listEdges(deps.db, canvas.id),
      contentByNodeId,
    })
    if (assembled.included.length === 0) {
      return {
        ok: false,
        error: appError('context_empty', 'no injectable content', { taskId: task.id }),
      }
    }

    const note = input.note?.trim() ? input.note.trim() : DEFAULT_NOTE
    const requestedChars = contextUpdateChars(assembled, note)
    const used = cumulativeInjectedChars(task.context)
    if (used + requestedChars > MAX_CUMULATIVE_INJECTION_CHARS) {
      return {
        ok: false,
        error: appError('context_budget_exceeded', 'cumulative injection budget exceeded', {
          limit: MAX_CUMULATIVE_INJECTION_CHARS,
          used,
          requested: requestedChars,
        }),
      }
    }

    const seq = (task.context?.injections.length ?? 0) + 1
    const injection: ContextInjection = {
      seq,
      at: deps.now(),
      source: input.source,
      note,
      nodeIds: input.nodeIds,
      included: assembled.included,
      dropped: assembled.dropped,
      truncated: assembled.truncated,
      relations: assembled.relations,
      relationsTruncated: assembled.relationsTruncated,
      chars: requestedChars,
    }
    const block = buildContextUpdateBlock({
      seq,
      at: injection.at,
      source: injection.source,
      note,
      assembled,
    })
    return { ok: true, task, injection, block }
  }

  function injectContext(input: InjectContextInput): InjectContextResult {
    const prepared = prepare(input)
    if (!prepared.ok) return prepared
    const { task, injection, block } = prepared

    if (task.status === 'waiting_input') {
      if (!deps.hasSession(task.id)) {
        return {
          ok: false,
          error: appError('session_not_active', 'no active session for task', { taskId: task.id }),
        }
      }
      const outcome = deps.applyTransition(task.id, {
        type: 'user_input',
        text: block,
        contextInjection: injection,
      })
      if (!outcome.ok) return outcome
      return {
        ok: true,
        taskId: task.id,
        seq: injection.seq,
        truncated: injection.truncated,
        dropped: injection.dropped.length,
      }
    }

    const event = deps.db.transaction((tx) => {
      appendTaskPromptRaw(tx, task.id, block, MAX_PROMPT_BLOCK_CHARS, deps.now())
      appendTaskContextInjection(tx, task.id, injection, {
        maxCumulativeChars: MAX_CUMULATIVE_INJECTION_CHARS,
      })
      insertAudit(tx, {
        id: deps.newId(),
        ts: deps.now(),
        actor: input.actor,
        action: 'task.context.inject',
        detail: {
          taskId: task.id,
          seq: injection.seq,
          source: input.source,
          nodeIds: input.nodeIds,
          chars: injection.chars,
          dropped: injection.dropped.length,
          truncated: injection.truncated,
        },
      })
      if (input.source === 'supervisor') {
        insertAudit(tx, {
          id: deps.newId(),
          ts: deps.now(),
          actor: 'supervisor',
          action: 'supervisor.context.inject',
          detail: {
            taskId: task.id,
            seq: injection.seq,
            nodeIds: input.nodeIds,
            chars: injection.chars,
            dropped: injection.dropped.length,
          },
        })
      }
      return deps.eventStore.appendContextInjected(tx, {
        taskId: task.id,
        seq: injection.seq,
        at: injection.at,
        source: input.source,
        nodeIds: input.nodeIds,
        chars: injection.chars,
        ts: deps.now(),
      })
    })
    deps.broadcast(event)
    return {
      ok: true,
      taskId: task.id,
      seq: injection.seq,
      truncated: injection.truncated,
      dropped: injection.dropped.length,
    }
  }

  return { injectContext, prepareContextInjection: prepare }
}

export type ContextService = ReturnType<typeof createContextService>
