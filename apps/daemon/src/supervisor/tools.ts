import {
  buildTaskOrigin,
  boardColumn,
  attentionFor,
  needsPerson,
  waitingSinceFor,
} from '@baton/core'
import {
  Engine,
  Node,
  SupervisorTaskCard,
  TaskStatus,
  type Actor,
  type AppError,
  type Engine as EngineValue,
  type SupervisorTaskCard as SupervisorTaskCardValue,
  type Task,
} from '@baton/protocol'
import { z } from 'zod'
import {
  getCanvasByWorkspace,
  getNode,
  getReviewByTask,
  getTaskDetail,
  insertNode,
  listEdges,
  listNodes,
  listApprovalsByTask,
  listReviewsByTask,
  listSessionsByTask,
  listTaskStatusHistory,
  listTasks,
  updateTaskTitle,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import { createEdge as createCanvasEdge } from '../runtime/edge-service.js'
import type { TaskService } from '../runtime/task-service.js'
import { nodeSummary, textTitle } from './canvas-summary.js'

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
  memo: { taskId?: string; createdNodeIds?: string[] }
}

export interface SupervisorTool {
  description: string
  parameters: z.ZodType
  execute(input: unknown, ctx: ToolContext): Promise<unknown>
}

export interface SupervisorToolset {
  list_canvas: SupervisorTool
  list_tasks: SupervisorTool
  get_task: SupervisorTool
  get_task_history: SupervisorTool
  create_task: SupervisorTool
  enqueue_task: SupervisorTool
  create_text: SupervisorTool
  create_agent: SupervisorTool
  create_edge: SupervisorTool
}

export interface BoundTool {
  description: string
  parameters: z.ZodType
  execute(input: unknown): Promise<unknown>
}

export interface BoundToolset {
  list_canvas: BoundTool
  list_tasks: BoundTool
  get_task: BoundTool
  get_task_history: BoundTool
  create_task: BoundTool
  enqueue_task: BoundTool
  create_text: BoundTool
  create_agent: BoundTool
  create_edge: BoundTool
}

export function bindTools(tools: SupervisorToolset, ctx: ToolContext): BoundToolset {
  const bind = (tool: SupervisorTool): BoundTool => ({
    description: tool.description,
    parameters: tool.parameters,
    execute: (input: unknown) => tool.execute(input, ctx),
  })
  return {
    list_canvas: bind(tools.list_canvas),
    list_tasks: bind(tools.list_tasks),
    get_task: bind(tools.get_task),
    get_task_history: bind(tools.get_task_history),
    create_task: bind(tools.create_task),
    enqueue_task: bind(tools.enqueue_task),
    create_text: bind(tools.create_text),
    create_agent: bind(tools.create_agent),
    create_edge: bind(tools.create_edge),
  }
}

const listTasksInput = z.object({
  filter: z.enum(['all', 'attention']).default('all'),
  status: TaskStatus.optional(),
  q: z.string().trim().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(50).default(20),
})

const listCanvasInput = z.object({
  limit: z.number().int().min(1).max(200).default(100),
})

const getTaskInput = z.object({ taskId: z.string().min(1) })

const getTaskHistoryInput = z.object({
  taskId: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(20),
})

const createTaskInput = z.object({
  title: z.string().min(1).max(80),
  agentTitle: z.string().min(1).max(80).optional(),
  targetNodeId: z.string().min(1).optional(),
  contextNodeIds: z.array(z.string().min(1)).max(40).optional(),
  engine: Engine.optional(),
  workspaceMode: z.enum(['main', 'worktree']).default('main'),
  start: z.boolean().default(false),
})

const enqueueTaskInput = z.object({ taskId: z.string().min(1) })

const createTextInput = z.object({
  content: z.string().min(1).max(16_384),
  title: z.string().min(1).max(80).optional(),
})

const createAgentInput = z.object({
  title: z.string().min(1).max(80).optional(),
  engine: Engine.optional(),
})

const createEdgeInput = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
})

export type EnqueueTaskResult = { ok: true; status: TaskStatus } | { ok: false; error: AppError }

export interface SupervisorToolsDeps {
  db: Db
  taskService: TaskService
  now: () => number
  newId: () => string
  defaultEngine: EngineValue
  enqueueTask: (taskId: string) => EnqueueTaskResult
}

const CONTENT_TYPES = new Set(['text', 'file', 'image'])

const AskUserQuestionInput = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        header: z.string().optional(),
        options: z
          .array(z.object({ label: z.string().min(1), description: z.string().optional() }))
          .optional(),
      }),
    )
    .min(1),
})

function pendingForTask(db: Db, task: Task): unknown {
  if (task.status !== 'waiting_input') return null
  if (task.waitingReason !== 'approval') {
    return task.waitingReason ? { kind: task.waitingReason } : null
  }
  const approval = listApprovalsByTask(db, task.id)
    .filter((item) => item.decision === null)
    .at(-1)
  if (!approval) return { kind: 'approval' }
  const base = {
    kind: 'approval' as const,
    approval: {
      toolName: approval.request.toolName,
      risk: approval.request.risk,
      ...(approval.request.reason ? { reason: approval.request.reason } : {}),
    },
  }
  if (approval.request.toolName !== 'AskUserQuestion') return base
  const parsed = AskUserQuestionInput.safeParse(approval.request.input)
  if (!parsed.success) return base
  return { kind: 'question' as const, question: parsed.data }
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

  function canvasFor(ctx: ToolContext) {
    const canvas = getCanvasByWorkspace(deps.db, ctx.workspaceId)
    if (!canvas) {
      throw appError('canvas_not_found', 'canvas not found', { workspaceId: ctx.workspaceId })
    }
    return canvas
  }

  function nextNodeY(canvasId: string): number {
    const nodes = listNodes(deps.db, canvasId)
    return nodes.reduce((max, node) => Math.max(max, node.y + node.h), 40) + 24
  }

  function insertCanvasNode(
    ctx: ToolContext,
    type: 'text' | 'agent',
    data: Record<string, unknown>,
  ): Node {
    const canvas = canvasFor(ctx)
    const ts = deps.now()
    const node = Node.parse({
      id: deps.newId(),
      canvasId: canvas.id,
      type,
      x: 80,
      y: nextNodeY(canvas.id),
      w: 320,
      h: 200,
      groupId: null,
      data,
      createdAt: ts,
      updatedAt: ts,
    })
    deps.db.transaction((tx) => insertNode(tx, node))
    ctx.memo.createdNodeIds = [...(ctx.memo.createdNodeIds ?? []), node.id]
    return node
  }

  function createAgentNode(
    ctx: ToolContext,
    options: { title?: string; engine?: EngineValue },
  ): { nodeId: string; title: string; engine: EngineValue } {
    const canvas = canvasFor(ctx)
    const agentCount = listNodes(deps.db, canvas.id).filter((node) => node.type === 'agent').length
    const title = options.title?.trim() || `Agent ${agentCount + 1}`
    const engine = options.engine ?? deps.defaultEngine
    const node = insertCanvasNode(ctx, 'agent', { title, engine, taskId: null })
    return { nodeId: node.id, title, engine }
  }

  function resolveAgentTarget(
    ctx: ToolContext,
    parsed: z.infer<typeof createTaskInput>,
  ): { id: string; title: string; engine: EngineValue; created: boolean } {
    const canvas = canvasFor(ctx)
    const requested =
      parsed.targetNodeId ??
      ctx.selection.targetNodeId ??
      (ctx.selection.agentCandidates.length === 1
        ? ctx.selection.agentCandidates[0]?.id
        : undefined)
    if (requested) {
      const node = getNode(deps.db, requested)
      if (!node || node.canvasId !== canvas.id || node.type !== 'agent') {
        throw appError('supervisor_target_invalid', 'target agent is not on this canvas', {
          targetNodeId: requested,
        })
      }
      return {
        id: node.id,
        title: node.data.title,
        engine: Engine.parse(node.data.engine),
        created: false,
      }
    }

    const created = createAgentNode(ctx, {
      title: parsed.agentTitle ?? parsed.title,
      ...(parsed.engine ? { engine: parsed.engine } : {}),
    })
    return { id: created.nodeId, title: created.title, engine: created.engine, created: true }
  }

  function resolveContext(ctx: ToolContext, requested: string[], targetId: string): string[] {
    const canvas = canvasFor(ctx)
    const contentIds = new Set(
      listNodes(deps.db, canvas.id)
        .filter((node) => CONTENT_TYPES.has(node.type))
        .map((node) => node.id),
    )
    const invalid = requested.filter((id) => id !== targetId && !contentIds.has(id))
    if (invalid.length > 0) {
      throw appError('supervisor_context_invalid', 'context nodes are not on this canvas', {
        nodeIds: invalid,
      })
    }
    return [...new Set(requested.filter((id) => id !== targetId))]
  }

  function resolveEngine(
    parsedEngine: EngineValue | undefined,
    target: { engine: EngineValue; created: boolean },
  ): EngineValue {
    if (parsedEngine) return parsedEngine
    if (target.created) return deps.defaultEngine
    // 用户手工建节点时默认是 fake（演示引擎）；总管派活默认用真实引擎。
    if (target.engine === 'fake' && deps.defaultEngine !== 'fake') return deps.defaultEngine
    return target.engine
  }

  return {
    list_canvas: {
      description:
        '读取当前画布的节点与连线摘要（文本给预览，文件只给名称/路径，不读文件内容）；' +
        '用户问画布上有什么、收集了哪些信息时使用。',
      parameters: listCanvasInput,
      async execute(input, ctx) {
        const parsed = listCanvasInput.parse(input)
        const canvas = canvasFor(ctx)
        const nodes = listNodes(deps.db, canvas.id)
        const edges = listEdges(deps.db, canvas.id)
        const shownNodes = nodes.slice(0, parsed.limit)
        const shownEdges = edges.slice(0, 200)
        return {
          canvasId: canvas.id,
          nodes: shownNodes.map(nodeSummary),
          edges: shownEdges.map((edge) => ({
            id: edge.id,
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            type: edge.type,
          })),
          totalNodes: nodes.length,
          totalEdges: edges.length,
          truncated: nodes.length > shownNodes.length || edges.length > shownEdges.length,
        }
      },
    },

    list_tasks: {
      description: '列出当前 workspace 的任务；filter=attention 只返回需要人处理的任务。',
      parameters: listTasksInput,
      async execute(input, ctx) {
        const parsed = listTasksInput.parse(input)
        const needle = parsed.q?.toLowerCase()
        const tasks = listTasks(deps.db, {
          workspaceId: ctx.workspaceId,
          ...(parsed.status ? { status: parsed.status } : {}),
        })
          .filter(
            (task) =>
              !needle ||
              task.title.toLowerCase().includes(needle) ||
              task.id.toLowerCase().startsWith(needle),
          )
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
      description:
        '读取一个任务的元数据、session 摘要与 review 摘要；' + '不返回 transcript 或日志。',
      parameters: getTaskInput,
      async execute(input, ctx) {
        const parsed = getTaskInput.parse(input)
        const detail = getTaskDetail(deps.db, parsed.taskId)
        // 总管只能看到当前 workspace 的任务，避免跨工作区读取。
        if (!detail || detail.task.workspaceId !== ctx.workspaceId) {
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
            ? {
                verdict: review.verdict,
                verifyExitCode: review.verifyExitCode,
                diffStat: review.diffStat,
              }
            : null,
          context: task.context
            ? {
                included: task.context.included.length,
                dropped: task.context.dropped.length,
                relations: task.context.relations.length,
                truncated: task.context.truncated || task.context.relationsTruncated,
              }
            : null,
          pending: pendingForTask(deps.db, task),
        }
      },
    },

    get_task_history: {
      description:
        '读取任务状态转移、session 与 review 摘要；不返回 transcript、日志或 diff 正文。',
      parameters: getTaskHistoryInput,
      async execute(input, ctx) {
        const parsed = getTaskHistoryInput.parse(input)
        const detail = getTaskDetail(deps.db, parsed.taskId)
        if (!detail || detail.task.workspaceId !== ctx.workspaceId) {
          throw appError('task_not_found', 'task not found', { taskId: parsed.taskId })
        }
        const history = listTaskStatusHistory(deps.db, parsed.taskId, parsed.limit)
        return {
          taskId: parsed.taskId,
          statusEvents: history.items,
          sessions: listSessionsByTask(deps.db, parsed.taskId),
          reviews: listReviewsByTask(deps.db, parsed.taskId),
          ...(history.nextBeforeOrdinal !== undefined
            ? { nextBeforeOrdinal: history.nextBeforeOrdinal }
            : {}),
        }
      },
    },

    create_text: {
      description:
        '在当前画布创建文本节点，用于承载需求、资料或说明；返回 nodeId，可继续作为 create_task 的上下文。',
      parameters: createTextInput,
      async execute(input, ctx) {
        const parsed = createTextInput.parse(input)
        const node = insertCanvasNode(ctx, 'text', { content: parsed.content })
        return {
          nodeId: node.id,
          type: 'text',
          title: parsed.title ?? textTitle(parsed.content),
        }
      },
    },

    create_agent: {
      description:
        '在当前画布创建 Agent 节点；不传 engine 时使用默认引擎。返回 nodeId 与 engine，可直接用于 create_task。',
      parameters: createAgentInput,
      async execute(input, ctx) {
        const parsed = createAgentInput.parse(input)
        return createAgentNode(ctx, parsed)
      },
    },

    create_edge: {
      description: '把两个画布节点用 context 边连接起来，作为后续任务的上下文依赖。',
      parameters: createEdgeInput,
      async execute(input, ctx) {
        const parsed = createEdgeInput.parse(input)
        const canvas = canvasFor(ctx)
        const source = getNode(deps.db, parsed.sourceId)
        const target = getNode(deps.db, parsed.targetId)
        if (!source || !target || source.canvasId !== canvas.id || target.canvasId !== canvas.id) {
          throw appError('node_not_found', 'edge endpoints are not on this canvas', {
            nodeIds: [parsed.sourceId, parsed.targetId],
          })
        }
        const result = createCanvasEdge(
          { db: deps.db, newId: deps.newId },
          { sourceId: parsed.sourceId, targetId: parsed.targetId, type: 'context' },
        )
        if (!result.ok) throw result.error
        return { edgeId: result.edgeId }
      },
    },

    create_task: {
      description:
        '创建任务；没有目标 Agent 时会自动创建一个 Agent 节点。只有用户明确要求隔离/worktree 时才传 workspaceMode=worktree。start=true 时立即开工。',
      parameters: createTaskInput,
      async execute(input, ctx) {
        const parsed = createTaskInput.parse(input)
        if (ctx.memo.taskId) {
          const existing = getTaskDetail(deps.db, ctx.memo.taskId)
          if (existing) {
            const node = existing.task.nodeId ? getNode(deps.db, existing.task.nodeId) : undefined
            const target = {
              id: existing.task.nodeId ?? 'unknown',
              title: node?.type === 'agent' ? node.data.title : 'Agent',
              engine: Engine.parse(existing.task.engine),
            }
            let title = existing.task.title
            let status: 'todo' | 'queued' = existing.task.status === 'queued' ? 'queued' : 'todo'
            if (existing.task.status === 'todo' && parsed.title !== existing.task.title) {
              // 同一轮里模型可能先建错标题，再补一次正确标题；任务尚未开工时允许纠正。
              updateTaskTitle(deps.db, existing.task.id, parsed.title, deps.now())
              title = parsed.title
            }
            if (parsed.start && existing.task.status === 'todo') {
              const outcome = deps.enqueueTask(existing.task.id)
              if (outcome.ok) status = 'queued'
            }
            return card(
              existing.task.id,
              title,
              target,
              existing.task.context?.included.length ?? 0,
              status,
            )
          }
        }

        const target = resolveAgentTarget(ctx, parsed)
        const engine = resolveEngine(parsed.engine, target)
        const requestedContext = parsed.contextNodeIds ?? ctx.selection.contextNodeIds
        const contextNodeIds = resolveContext(ctx, requestedContext, target.id)

        const origin = buildTaskOrigin({
          source: 'supervisor-chat',
          triggerId: ctx.triggerId,
          threadId: ctx.threadId,
          workspaceId: ctx.workspaceId,
          targetNodeId: target.id,
          contextNodeIds,
          policyVersion: ctx.policyVersion,
          promptVersion: ctx.promptVersion,
          createdAt: deps.now(),
        })
        const result = deps.taskService.createTask(
          {
            workspaceId: ctx.workspaceId,
            nodeId: target.id,
            title: parsed.title,
            prompt: ctx.text,
            contextNodeIds,
            engine,
            workspaceMode: parsed.workspaceMode,
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
                engine,
                createdAgent: target.created,
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

        let status: 'todo' | 'queued' = 'todo'
        let startError: string | undefined
        if (parsed.start) {
          const outcome = deps.enqueueTask(result.taskId)
          if (outcome.ok) status = 'queued'
          else startError = outcome.error.message
        }
        return {
          ...card(result.taskId, parsed.title, target, contextNodeIds.length, status),
          started: status === 'queued',
          ...(startError ? { startError } : {}),
        }
      },
    },

    enqueue_task: {
      description: '把一个待办任务立即开工；只接受 todo 状态，验收仍由用户决定。',
      parameters: enqueueTaskInput,
      async execute(input, ctx) {
        const parsed = enqueueTaskInput.parse(input)
        const detail = getTaskDetail(deps.db, parsed.taskId)
        if (!detail || detail.task.workspaceId !== ctx.workspaceId) {
          throw appError('task_not_found', 'task not found', { taskId: parsed.taskId })
        }
        if (detail.task.status === 'queued' || detail.task.status === 'running') {
          return { taskId: detail.task.id, status: detail.task.status }
        }
        if (detail.task.status !== 'todo') {
          throw appError('task_not_enqueueable', 'task is not in todo state', {
            taskId: detail.task.id,
            status: detail.task.status,
          })
        }
        const outcome = deps.enqueueTask(parsed.taskId)
        if (!outcome.ok) throw outcome.error
        return { taskId: parsed.taskId, status: outcome.status }
      },
    },
  }
}

function card(
  taskId: string,
  title: string,
  target: { id: string; title: string; engine: string },
  contextCount: number,
  status: 'todo' | 'queued' = 'todo',
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
    status,
  })
}
