import {
  buildTaskOrigin,
  boardColumn,
  attentionFor,
  needsPerson,
  waitingSinceFor,
} from '@baton/core'
import {
  Engine,
  SupervisorTaskCard,
  type Actor,
  type SupervisorTaskCard as SupervisorTaskCardValue,
} from '@baton/protocol'
import { z } from 'zod'
import {
  getReviewByTask,
  getTaskDetail,
  listSessionsByTask,
  listTasks,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import type { TaskService } from '../runtime/task-service.js'

export interface AgentCandidate {
  id: string
  title: string
  engine: string
}

export interface ToolContext {
  workspaceId: string
  threadId: string
  triggerId: string
  text: string
  actor: Actor
  selection: {
    contextNodeIds: string[]
    targetNodeId?: string
    agentCandidates: AgentCandidate[]
  }
  policyVersion: string
  promptVersion: string
  memo: { taskId?: string }
}

export interface SupervisorTool {
  description: string
  parameters: z.ZodType
  execute(input: unknown, ctx: ToolContext): Promise<unknown>
}

export interface SupervisorToolset {
  list_tasks: SupervisorTool
  get_task: SupervisorTool
  create_task: SupervisorTool
}

export interface BoundTool {
  description: string
  parameters: z.ZodType
  execute(input: unknown): Promise<unknown>
}

export interface BoundToolset {
  list_tasks: BoundTool
  get_task: BoundTool
  create_task: BoundTool
}

export function bindTools(tools: SupervisorToolset, ctx: ToolContext): BoundToolset {
  const bind = (tool: SupervisorTool): BoundTool => ({
    description: tool.description,
    parameters: tool.parameters,
    execute: (input: unknown) => tool.execute(input, ctx),
  })
  return {
    list_tasks: bind(tools.list_tasks),
    get_task: bind(tools.get_task),
    create_task: bind(tools.create_task),
  }
}

const listTasksInput = z.object({
  filter: z.enum(['all', 'attention']).default('all'),
  limit: z.number().int().min(1).max(50).default(20),
})

const getTaskInput = z.object({ taskId: z.string().min(1) })

const createTaskInput = z.object({
  title: z.string().min(1).max(80),
  targetNodeId: z.string().min(1).optional(),
  contextNodeIds: z.array(z.string().min(1)).max(40).optional(),
})

export interface SupervisorToolsDeps {
  db: Db
  taskService: TaskService
  now: () => number
}

export function createSupervisorTools(deps: SupervisorToolsDeps): SupervisorToolset {
  function taskSummary(task: ReturnType<typeof listTasks>[number], column: string) {
    const attention = attentionFor(task.status, task.waitingReason)
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      waitingReason: task.waitingReason,
      engine: task.engine,
      retryCount: task.retryCount,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      attention,
      waitingSince: waitingSinceFor(task),
      column,
      needsPerson: needsPerson({ status: task.status, attention }),
    }
  }

  return {
    list_tasks: {
      description: '列出当前 workspace 的任务；filter=attention 只返回需要人处理的任务。',
      parameters: listTasksInput,
      async execute(input, ctx) {
        const parsed = listTasksInput.parse(input)
        const tasks = listTasks(deps.db, { workspaceId: ctx.workspaceId })
          .map((task) => taskSummary(task, boardColumn(task.status)))
          .filter((task) => (parsed.filter === 'attention' ? task.needsPerson : true))
          .sort((a, b) => {
            if (a.needsPerson !== b.needsPerson) return a.needsPerson ? -1 : 1
            const waitA = a.waitingSince ?? Number.MAX_SAFE_INTEGER
            const waitB = b.waitingSince ?? Number.MAX_SAFE_INTEGER
            return waitA - waitB || b.updatedAt - a.updatedAt
          })
          .slice(0, parsed.limit)
        return { tasks }
      },
    },

    get_task: {
      description: '读取一个任务的元数据、session 摘要与 review 摘要；不返回 transcript 或日志。',
      parameters: getTaskInput,
      async execute(input) {
        const parsed = getTaskInput.parse(input)
        const detail = getTaskDetail(deps.db, parsed.taskId)
        if (!detail) {
          throw appError('task_not_found', 'task not found', { taskId: parsed.taskId })
        }
        const task = detail.task
        const attention = attentionFor(task.status, task.waitingReason)
        const sessions = listSessionsByTask(deps.db, task.id)
        const session = sessions.at(-1)
        const review = getReviewByTask(deps.db, task.id)
        return {
          task: {
            id: task.id,
            title: task.title,
            status: task.status,
            waitingReason: task.waitingReason,
            attention,
            waitingSince: waitingSinceFor(task),
            column: boardColumn(task.status),
            needsPerson: needsPerson({ status: task.status, attention }),
            engine: task.engine,
            retryCount: task.retryCount,
            updatedAt: task.updatedAt,
          },
          session: session
            ? { status: session.status, outcome: session.outcome, startedAt: session.startedAt }
            : null,
          review: review
            ? { verdict: review.verdict, verifyExitCode: review.verifyExitCode }
            : null,
          context: task.context
            ? {
                included: task.context.included.length,
                dropped: task.context.dropped.length,
                relations: task.context.relations.length,
                truncated: task.context.truncated || task.context.relationsTruncated,
              }
            : null,
        }
      },
    },

    create_task: {
      description: '用户明确要求建任务时，把当前选择交给目标 Agent；只创建到 todo，不开工。',
      parameters: createTaskInput,
      async execute(input, ctx) {
        const parsed = createTaskInput.parse(input)
        if (ctx.memo.taskId) {
          const existing = getTaskDetail(deps.db, ctx.memo.taskId)
          if (existing) {
            const target = ctx.selection.agentCandidates.find(
              (candidate) => candidate.id === existing.task.nodeId,
            )
            return card(
              existing.task.id,
              existing.task.title,
              target ?? {
                id: existing.task.nodeId ?? 'unknown',
                title: 'Agent',
                engine: existing.task.engine,
              },
              existing.task.context?.included.length ?? 0,
            )
          }
        }

        const targetId =
          parsed.targetNodeId ??
          ctx.selection.targetNodeId ??
          (ctx.selection.agentCandidates.length === 1
            ? ctx.selection.agentCandidates[0]?.id
            : undefined)
        if (!targetId) {
          throw appError('supervisor_target_invalid', 'target agent is required', {
            agentCandidates: ctx.selection.agentCandidates,
          })
        }
        const target = ctx.selection.agentCandidates.find((candidate) => candidate.id === targetId)
        if (!target) {
          throw appError(
            'supervisor_target_invalid',
            'target agent is not in the current selection',
            {
              targetNodeId: targetId,
              agentCandidates: ctx.selection.agentCandidates,
            },
          )
        }

        const requestedContext = parsed.contextNodeIds ?? ctx.selection.contextNodeIds
        const invalid = requestedContext.filter((id) => !ctx.selection.contextNodeIds.includes(id))
        if (invalid.length > 0) {
          throw appError(
            'supervisor_context_invalid',
            'context nodes are not in the current selection',
            {
              nodeIds: invalid,
            },
          )
        }
        const contextNodeIds = requestedContext.filter((id) => id !== targetId)

        const origin = buildTaskOrigin({
          source: 'supervisor-chat',
          triggerId: ctx.triggerId,
          threadId: ctx.threadId,
          workspaceId: ctx.workspaceId,
          targetNodeId: targetId,
          contextNodeIds,
          policyVersion: ctx.policyVersion,
          promptVersion: ctx.promptVersion,
          createdAt: deps.now(),
        })
        const result = deps.taskService.createTask(
          {
            workspaceId: ctx.workspaceId,
            nodeId: targetId,
            title: parsed.title,
            prompt: ctx.text,
            contextNodeIds,
            engine: Engine.parse(target.engine),
            workspaceMode: 'main',
            dangerouslySkipPermissions: false,
          },
          {
            origin,
            audit: {
              actor: 'supervisor',
              action: 'supervisor.task.create',
              detail: {
                triggerId: ctx.triggerId,
                threadId: ctx.threadId,
                policyVersion: ctx.policyVersion,
                contextNodeIds,
              },
            },
          },
        )
        if (!result.ok) {
          throw appError('supervisor_task_create_failed', result.error.message, {
            code: result.error.code,
            details: result.error.details,
          })
        }
        ctx.memo.taskId = result.taskId
        return card(result.taskId, parsed.title, target, contextNodeIds.length)
      },
    },
  }
}

function card(
  taskId: string,
  title: string,
  target: AgentCandidate,
  contextCount: number,
): SupervisorTaskCardValue {
  return SupervisorTaskCard.parse({
    taskId,
    title,
    target: {
      id: target.id,
      title: target.title,
      engine: Engine.parse(target.engine),
    },
    contextCount,
    status: 'todo',
  })
}
