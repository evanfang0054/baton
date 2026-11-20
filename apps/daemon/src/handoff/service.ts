import { buildHandoffSummary, type HandoffFile, type HandoffSummary } from '@baton/core'
import { Node as NodeSchema } from '@baton/protocol'
import type { AppError, Node, TaskStatus } from '@baton/protocol'
import {
  getCanvasByWorkspace,
  getLastAssistantText,
  getNode,
  getReviewByTask,
  getReviewDiff,
  getSessionOutcomeReason,
  getTaskDetail,
  getWorkspace,
  insertAudit,
  insertNode,
  listSessionsByTask,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import { resolveWorkspaceDir } from '../workspace/resolver.js'

export interface HandoffDeps {
  db: Db
  workspacesRoot: string
  now: () => number
  newId: () => string
}

export interface CreateHandoffInput {
  taskId: string
  /** 传了就校验归属；WS 命令与总管工具都带上当前 workspace。 */
  workspaceId?: string
  actor: string
}

export type HandoffResult =
  { ok: true; node: Node; summary: HandoffSummary } | { ok: false; error: AppError }

const HANDOFF_STATUSES: ReadonlySet<TaskStatus> = new Set(['review', 'done', 'failed', 'cancelled'])

const TASK_BLOCK = /^<task>([\s\S]*?)<\/task>/

function extractGoal(prompt: string, title: string): string {
  const match = TASK_BLOCK.exec(prompt)
  const goal = match?.[1]?.trim()
  return goal && goal.length > 0 ? goal : title
}

function toHandoffFiles(diff: ReturnType<typeof getReviewDiff>): HandoffFile[] {
  if (!diff) return []
  return diff.files.map((file) => ({
    path: file.path,
    status: file.status,
    insertions: file.insertions,
    deletions: file.deletions,
  }))
}

export function createHandoffNode(deps: HandoffDeps, input: CreateHandoffInput): HandoffResult {
  const detail = getTaskDetail(deps.db, input.taskId)
  if (!detail) {
    return { ok: false, error: appError('task_not_found', 'task not found') }
  }
  const task = detail.task
  const workspace = getWorkspace(deps.db, task.workspaceId)
  if (!workspace) {
    return { ok: false, error: appError('workspace_not_found', 'workspace not found') }
  }
  // 跨 workspace 不泄露任务存在性。
  if (input.workspaceId && input.workspaceId !== workspace.id) {
    return { ok: false, error: appError('task_not_found', 'task not found') }
  }
  if (!HANDOFF_STATUSES.has(task.status)) {
    return {
      ok: false,
      error: appError('handoff_invalid', 'task is not in a handoffable state', {
        taskId: task.id,
        status: task.status,
      }),
    }
  }

  const sessions = listSessionsByTask(deps.db, task.id)
  const review = getReviewByTask(deps.db, task.id)
  if (sessions.length === 0 && !review) {
    return {
      ok: false,
      error: appError('handoff_no_result', 'task has no session or review to hand off', {
        taskId: task.id,
      }),
    }
  }

  const session = sessions.at(-1) ?? null
  const lastReply = session ? getLastAssistantText(deps.db, session.id, 2_000) : ''
  const failureReason = session ? getSessionOutcomeReason(deps.db, session.id) : null
  const diff = review ? getReviewDiff(deps.db, review.id) : null

  let workspacePath: string
  try {
    workspacePath = resolveWorkspaceDir(deps.workspacesRoot, workspace.relPath)
  } catch {
    return { ok: false, error: appError('workspace_not_found', 'workspace path is unavailable') }
  }

  const redactPaths = [workspacePath, deps.workspacesRoot]
  if (task.worktreePath) redactPaths.push(task.worktreePath)

  const summary = buildHandoffSummary({
    task: { id: task.id, title: task.title, status: task.status },
    goal: extractGoal(task.prompt, task.title),
    session: { outcome: session?.outcome ?? null, failureReason },
    review: review
      ? {
          verifyExitCode: review.verifyExitCode,
          diffStat: review.diffStat,
          files: toHandoffFiles(diff),
        }
      : null,
    artifact: {
      worktree: task.workspaceMode === 'worktree',
      branch: task.branch,
    },
    lastReply: lastReply.trim() ? lastReply : null,
    redactPaths,
  })

  const anchor = task.nodeId ? getNode(deps.db, task.nodeId) : null
  const canvas = anchor ? { id: anchor.canvasId } : getCanvasByWorkspace(deps.db, workspace.id)
  if (!canvas) {
    return { ok: false, error: appError('canvas_not_found', 'canvas not found') }
  }

  const ts = deps.now()
  const node = NodeSchema.parse({
    id: deps.newId(),
    canvasId: canvas.id,
    type: 'text',
    x: anchor ? (anchor.type === 'agent' ? anchor.x + anchor.w + 40 : anchor.x) : 0,
    y: anchor ? anchor.y : 0,
    w: 360,
    h: 260,
    groupId: null,
    data: { content: summary.content },
    createdAt: ts,
    updatedAt: ts,
  })

  try {
    deps.db.transaction((tx) => {
      insertNode(tx, node)
      insertAudit(tx, {
        id: deps.newId(),
        ts,
        actor: input.actor,
        action: 'task.handoff.create',
        detail: {
          taskId: task.id,
          nodeId: node.id,
          worktree: task.workspaceMode === 'worktree',
          truncated: summary.truncated,
          warnings: summary.warnings,
        },
      })
    })
  } catch {
    return {
      ok: false,
      error: appError('handoff_node_failed', 'failed to create handoff node', {
        taskId: task.id,
      }),
    }
  }

  return { ok: true, node, summary }
}
