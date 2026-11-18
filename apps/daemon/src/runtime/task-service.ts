import { assembleContext } from '@baton/core'
import type { AppError, TaskCreateInput } from '@baton/protocol'
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

export interface TaskServiceDeps {
  db: Db
  config: Config
  now: () => number
  newId: () => string
}

export type CreateTaskResult = { ok: true; taskId: string } | { ok: false; error: AppError }

export function createTaskService(deps: TaskServiceDeps) {
  function createTask(input: TaskCreateInput): CreateTaskResult {
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
      if (input.workspaceMode !== 'main') {
        return {
          ok: false,
          error: appError('unsupported_workspace_mode', 'worktree mode is not available', {
            workspaceMode: input.workspaceMode,
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

      const workspacePath = resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
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
      deps.db.transaction((tx) => {
        insertTask(tx, {
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
          retryCount: 0,
          dangerouslySkipPermissions: input.dangerouslySkipPermissions,
          createdAt: now,
          updatedAt: now,
        })
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
