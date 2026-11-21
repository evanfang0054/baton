import { assembleContext } from '@baton/core'
import type { AppError, TaskCreateInput, TaskOrigin } from '@baton/protocol'
import type { Config } from '../config.js'
import {
  getCanvasByWorkspace,
  getWorkspace,
  insertAudit,
  insertTask,
  listEdges,
  listNodes,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError, toAppError } from '../errors.js'
import { buildContextContent } from '../workspace/context.js'
import { loadPolicy } from '../workspace/policy.js'
import { resolveWorkspaceDir } from '../workspace/resolver.js'
import { isGitRepoSync } from '../workspace/worktree.js'

export interface TaskServiceDeps {
  db: Db
  config: Config
  now: () => number
  newId: () => string
}

export type CreateTaskResult = { ok: true; taskId: string } | { ok: false; error: AppError }

export interface CreateTaskOptions {
  /** 只允许 daemon 内部（总管）传入；web 的 task.create 不传。 */
  origin?: TaskOrigin
  audit?: { actor: string; action: string; detail: Record<string, unknown> }
}

export function createTaskService(deps: TaskServiceDeps) {
  function createTask(input: TaskCreateInput, options: CreateTaskOptions = {}): CreateTaskResult {
    try {
      const workspace = getWorkspace(deps.db, input.workspaceId)
      if (!workspace) {
        return {
          ok: false,
          error: appError('workspace_not_found', 'workspace not found', {
            workspaceId: input.workspaceId,
          }),
        }
      }
      const workspacePath = resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
      if (input.budgetUsd !== undefined && input.budgetUsd > deps.config.maxTaskBudgetUsd) {
        return {
          ok: false,
          error: appError('budget_too_large', 'task budget exceeds the configured maximum', {
            budgetUsd: input.budgetUsd,
            maxTaskBudgetUsd: deps.config.maxTaskBudgetUsd,
          }),
        }
      }
      if (input.workspaceMode === 'worktree' && !isGitRepoSync(workspacePath)) {
        return {
          ok: false,
          error: appError('worktree_unavailable', 'workspace is not a git repository', {
            workspaceId: workspace.id,
          }),
        }
      }
      if (input.dangerouslySkipPermissions) {
        if (!deps.config.allowBypassPermissions) {
          return {
            ok: false,
            error: appError(
              'bypass_not_allowed',
              'dangerously skip permissions is disabled; set BATON_ALLOW_BYPASS_PERMISSIONS=1',
            ),
          }
        }
        if (!workspace.trusted) {
          return {
            ok: false,
            error: appError(
              'workspace_untrusted',
              'workspace must be trusted before skipping permissions',
              { workspaceId: workspace.id },
            ),
          }
        }
      }
      if (input.engine === 'pty') {
        return {
          ok: false,
          error: appError('unsupported_engine', 'PTY engine is not available in v1', {
            engine: input.engine,
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
      const edges = listEdges(deps.db, canvas.id)
      const target = nodes.find((node) => node.id === input.nodeId)
      if (!target) {
        return {
          ok: false,
          error: appError('node_not_found', 'target node not found', { nodeId: input.nodeId }),
        }
      }
      if (target.type !== 'agent') {
        return {
          ok: false,
          error: appError('invalid_payload', 'target node must be an agent node', {
            nodeId: input.nodeId,
          }),
        }
      }

      const nodeIds = new Set(nodes.map((node) => node.id))
      const missing = input.contextNodeIds.filter((id) => !nodeIds.has(id))
      if (missing.length > 0) {
        return {
          ok: false,
          error: appError('node_not_found', 'context node not found', { nodeIds: missing }),
        }
      }

      // 创建时就校验策略；执行期会把同一份快照传给适配器。
      loadPolicy(workspacePath)
      const { contentByNodeId } = buildContextContent({ nodes, workspacePath })
      const assembled = assembleContext({
        taskPrompt: input.prompt,
        targetNodeId: input.nodeId,
        selectedNodeIds: input.contextNodeIds,
        nodes,
        edges,
        contentByNodeId,
      })

      const now = deps.now()
      const taskId = deps.newId()
      const snapshot = {
        included: assembled.included,
        dropped: assembled.dropped,
        truncated: assembled.truncated,
        redactedPaths: assembled.redactedPaths,
        relations: assembled.relations,
        relationsTruncated: assembled.relationsTruncated,
      }
      deps.db.transaction((tx) => {
        insertTask(
          tx,
          {
            id: taskId,
            workspaceId: workspace.id,
            nodeId: input.nodeId,
            title: input.title,
            prompt: assembled.prompt,
            status: 'todo',
            waitingReason: null,
            engine: input.engine,
            workspaceMode: input.workspaceMode,
            branch: null,
            worktreePath: null,
            verifyCommand: input.verifyCommand ?? null,
            budgetUsd: input.budgetUsd ?? null,
            retryCount: 0,
            dangerouslySkipPermissions: input.dangerouslySkipPermissions,
            createdAt: now,
            updatedAt: now,
          },
          JSON.stringify(snapshot),
          options.origin ? JSON.stringify(options.origin) : null,
        )
        if (options.audit) {
          insertAudit(tx, {
            id: deps.newId(),
            ts: now,
            actor: options.audit.actor,
            action: options.audit.action,
            detail: options.audit.detail,
          })
        }
        if (input.dangerouslySkipPermissions) {
          insertAudit(tx, {
            id: deps.newId(),
            ts: now,
            actor: 'user',
            action: 'task.bypass_permissions',
            detail: { taskId, workspaceId: workspace.id },
          })
        }
      })
      return { ok: true, taskId }
    } catch (error) {
      return { ok: false, error: toAppError(error) }
    }
  }

  return { createTask }
}

export type TaskService = ReturnType<typeof createTaskService>
