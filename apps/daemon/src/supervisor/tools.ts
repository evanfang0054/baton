import {
  buildTaskOrigin,
  boardColumn,
  attentionFor,
  canInjectContext,
  needsPerson,
  waitingSinceFor,
} from '@baton/core'
import {
  Engine,
  Node,
  SupervisorHandoffResult,
  SupervisorTaskCard,
  TaskStatus,
  type Actor,
  type AppError,
  type Engine as EngineValue,
  type SupervisorTaskCard as SupervisorTaskCardValue,
  type Task,
  type TaskAcceptanceSummary,
  type TaskTransitionEvent,
} from '@baton/protocol'
import { z } from 'zod'
import { getAcceptanceResponse } from '../acceptance/report-service.js'
import { getTaskBudgetSummary } from '../budget/service.js'
import { listAcceptanceSummaries } from '../db/acceptance-repository.js'
import {
  getCanvasByWorkspace,
  getNode,
  getReviewByTask,
  getTask,
  getTaskDetail,
  insertAudit,
  insertNode,
  listEdges,
  listNodes,
  listApprovalsByTask,
  listReviewsByTask,
  listSessionsByTask,
  listTaskStatusHistory,
  listTasks,
  moveNodes,
  updateNode,
  updateTaskTitle,
} from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import { createHandoffNode } from '../handoff/service.js'
import type { Logger } from '../log.js'
import { createEdge as createCanvasEdge } from '../runtime/edge-service.js'
import { ASK_USER_QUESTION_TOOL, readQuestions } from '../runtime/questions.js'
import type { TaskService } from '../runtime/task-service.js'
import type { TransitionOutcome } from '../runtime/types.js'
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
  memo: {
    taskId?: string
    createdNodeIds?: string[]
    batch?: { key: string; result: unknown }
  }
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
  retry_task: SupervisorTool
  reopen_task: SupervisorTool
  cancel_task: SupervisorTool
  reply_task: SupervisorTool
  inject_context: SupervisorTool
  create_tasks: SupervisorTool
  handoff_task: SupervisorTool
  create_text: SupervisorTool
  create_agent: SupervisorTool
  create_edge: SupervisorTool
  update_node: SupervisorTool
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
  retry_task: BoundTool
  reopen_task: BoundTool
  cancel_task: BoundTool
  reply_task: BoundTool
  inject_context: BoundTool
  create_tasks: BoundTool
  handoff_task: BoundTool
  create_text: BoundTool
  create_agent: BoundTool
  create_edge: BoundTool
  update_node: BoundTool
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
    retry_task: bind(tools.retry_task),
    reopen_task: bind(tools.reopen_task),
    cancel_task: bind(tools.cancel_task),
    reply_task: bind(tools.reply_task),
    inject_context: bind(tools.inject_context),
    create_tasks: bind(tools.create_tasks),
    handoff_task: bind(tools.handoff_task),
    create_text: bind(tools.create_text),
    create_agent: bind(tools.create_agent),
    create_edge: bind(tools.create_edge),
    update_node: bind(tools.update_node),
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

const injectContextInput = z.object({
  taskId: z.string().min(1),
  nodeIds: z.array(z.string().min(1)).min(1).max(40),
  note: z.string().max(2000).optional(),
})

const getTaskHistoryInput = z.object({
  taskId: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(20),
  beforeOrdinal: z.number().int().nonnegative().optional(),
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

const retryTaskInput = z.object({
  taskId: z.string().min(1),
  note: z.string().min(1).max(16_384).optional(),
})

const reopenTaskInput = z.object({
  taskId: z.string().min(1),
  note: z.string().min(1).max(16_384).optional(),
  start: z.boolean().default(false),
})

const cancelTaskInput = z.object({
  taskId: z.string().min(1),
  reason: z.string().min(1).max(1_000).optional(),
  confirm: z.boolean().default(false),
})

const replyTaskInput = z.object({
  taskId: z.string().min(1),
  text: z.string().min(1).max(16_384),
})

const createTasksInput = z.object({
  nodeIds: z.array(z.string().min(1)).min(1),
  targetNodeId: z.string().min(1).optional(),
  agentTitle: z.string().min(1).max(80).optional(),
  engine: Engine.optional(),
  contextNodeIds: z.array(z.string().min(1)).max(40).optional(),
  start: z.boolean().default(false),
})

const handoffTaskInput = z.object({
  fromTaskId: z.string().min(1),
  toNodeId: z.string().min(1).optional(),
  title: z.string().min(1).max(80).optional(),
  note: z.string().min(1).max(4_000).optional(),
  start: z.boolean().default(false),
})

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

const updateNodeInput = z
  .object({
    nodeId: z.string().min(1),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    title: z.string().min(1).max(120).optional(),
  })
  .strict()
  .refine((value) => value.x !== undefined || value.y !== undefined || value.title !== undefined, {
    message: 'at least one field is required',
  })

export type EnqueueTaskResult = { ok: true; status: TaskStatus } | { ok: false; error: AppError }

type BatchFailure = { nodeId: string; stage: 'create' | 'enqueue'; error: AppError }

export interface SupervisorToolsDeps {
  db: Db
  workspacesRoot: string
  claudeMaxBudgetUsd: number
  taskService: TaskService
  now: () => number
  newId: () => string
  defaultEngine: EngineValue
  enqueueTask: (taskId: string) => EnqueueTaskResult
  applyTransition: (taskId: string, event: TaskTransitionEvent) => TransitionOutcome
  replyToTask: (taskId: string, text: string) => { ok: boolean; error?: AppError }
  injectContext: (input: {
    taskId: string
    nodeIds: string[]
    note?: string
    source: 'user' | 'supervisor'
    actor: string
  }) =>
    | { ok: true; taskId: string; seq: number; truncated: boolean; dropped: number }
    | { ok: false; error: AppError }
  cancelTask: (taskId: string, reason?: string) => TransitionOutcome
  logger?: Logger
}

const CONTENT_TYPES = new Set(['text', 'file', 'image'])

function truncateText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

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
  if (approval.request.toolName !== ASK_USER_QUESTION_TOOL) return base
  const questions = readQuestions(approval.request)
  return questions ? { kind: 'question' as const, question: { questions } } : base
}

export function createSupervisorTools(deps: SupervisorToolsDeps): SupervisorToolset {
  function taskSummary(
    task: ReturnType<typeof listTasks>[number],
    column: string,
    acceptance: TaskAcceptanceSummary | null,
  ) {
    const attention = attentionFor(task.status, task.waitingReason)
    const budget = getTaskBudgetSummary(deps.db, task, {
      claudeMaxBudgetUsd: deps.claudeMaxBudgetUsd,
    })
    const needsAttention =
      needsPerson({ status: task.status, attention }) ||
      budget.overBudget ||
      (acceptance?.counts.fail ?? 0) > 0
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
      acceptance: acceptance
        ? {
            pass: acceptance.counts.pass,
            total: acceptance.counts.total,
            fail: acceptance.counts.fail,
          }
        : null,
      budget: {
        spent: budget.spentUsd,
        limit: budget.budgetUsd,
        over: budget.overBudget,
        near: budget.nearBudget,
      },
      needsPerson: needsAttention,
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
    parsed: {
      title: string
      targetNodeId?: string
      agentTitle?: string
      engine?: EngineValue
    },
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

  // 总管消息里经常只引用短 ID；严格全量 ID 会让模型把 "3ac390ff" 直接回填成 taskId。
  // 允许唯一前缀，并在歧义时返回候选，避免用户看到无法理解的 tool 失败。
  const TASK_ID_PREFIX_MIN = 4
  function resolveTaskId(workspaceId: string, input: string): string {
    const candidate = input.trim()
    const exact = getTask(deps.db, candidate)
    if (exact) {
      if (exact.workspaceId !== workspaceId) {
        throw appError('task_not_found', `task not found: ${candidate}`, { taskId: candidate })
      }
      return exact.id
    }
    if (candidate.length >= TASK_ID_PREFIX_MIN) {
      const prefix = candidate.toLowerCase()
      const matches = listTasks(deps.db, { workspaceId }).filter((task) =>
        task.id.toLowerCase().startsWith(prefix),
      )
      if (matches.length === 1) return matches[0]!.id
      if (matches.length > 1) {
        throw appError(
          'task_id_ambiguous',
          `task id "${candidate}" matches ${matches.length} tasks; use a longer prefix`,
          {
            taskId: candidate,
            candidates: matches.slice(0, 5).map((task) => ({ id: task.id, title: task.title })),
          },
        )
      }
    }
    throw appError('task_not_found', `task not found: ${candidate}`, { taskId: candidate })
  }

  function requireTask(ctx: ToolContext, taskId: string): Task {
    const task = getTask(deps.db, resolveTaskId(ctx.workspaceId, taskId))
    if (!task || task.workspaceId !== ctx.workspaceId) {
      throw appError('task_not_found', 'task not found', { taskId })
    }
    return task
  }

  function createTaskForTool(
    ctx: ToolContext,
    input: {
      title: string
      prompt: string
      target: { id: string; title: string; engine: EngineValue; created: boolean }
      contextNodeIds: string[]
      engine: EngineValue
      workspaceMode: 'main' | 'worktree'
      start: boolean
      auditDetail?: Record<string, unknown>
    },
  ): { taskId: string; status: 'todo' | 'queued'; startError?: string } {
    const origin = buildTaskOrigin({
      source: 'supervisor-chat',
      triggerId: ctx.triggerId,
      threadId: ctx.threadId,
      workspaceId: ctx.workspaceId,
      targetNodeId: input.target.id,
      contextNodeIds: input.contextNodeIds,
      policyVersion: ctx.policyVersion,
      promptVersion: ctx.promptVersion,
      createdAt: deps.now(),
    })
    const result = deps.taskService.createTask(
      {
        workspaceId: ctx.workspaceId,
        nodeId: input.target.id,
        title: input.title,
        prompt: input.prompt,
        contextNodeIds: input.contextNodeIds,
        engine: input.engine,
        workspaceMode: input.workspaceMode,
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
            contextNodeIds: input.contextNodeIds,
            engine: input.engine,
            createdAgent: input.target.created,
            ...input.auditDetail,
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
    let status: 'todo' | 'queued' = 'todo'
    let startError: string | undefined
    if (input.start) {
      const outcome = deps.enqueueTask(result.taskId)
      if (outcome.ok) status = 'queued'
      else startError = outcome.error.message
    }
    return {
      taskId: result.taskId,
      status,
      ...(startError ? { startError } : {}),
    }
  }

  function audit(
    action: string,
    taskId: string,
    ctx: ToolContext,
    detail: Record<string, unknown> = {},
  ): void {
    deps.db.transaction((tx) => {
      insertAudit(tx, {
        id: deps.newId(),
        ts: deps.now(),
        actor: 'supervisor',
        action,
        detail: { taskId, triggerId: ctx.triggerId, threadId: ctx.threadId, ...detail },
      })
    })
  }

  function transitionResult(outcome: TransitionOutcome): {
    ok: true
    taskId: string
    status: TaskStatus
  } {
    if (!outcome.ok) throw outcome.error
    return { ok: true, taskId: outcome.taskId, status: outcome.status }
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
      description:
        '列出当前 workspace 的任务；filter=attention 只返回需要人处理的任务（含超预算、AC 未过）。',
      parameters: listTasksInput,
      async execute(input, ctx) {
        const parsed = listTasksInput.parse(input)
        const needle = parsed.q?.toLowerCase()
        const rows = listTasks(deps.db, {
          workspaceId: ctx.workspaceId,
          ...(parsed.status ? { status: parsed.status } : {}),
        }).filter(
          (task) =>
            !needle ||
            task.title.toLowerCase().includes(needle) ||
            task.id.toLowerCase().startsWith(needle),
        )
        const acceptance = listAcceptanceSummaries(
          deps.db,
          rows.map((task) => task.id),
        )
        const tasks = rows
          .map((task) =>
            taskSummary(task, boardColumn(task.status), acceptance.get(task.id) ?? null),
          )
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
        '读取一个任务的元数据、验收摘要、成本用量、报告摘要、session 与 review 摘要；' +
        '不返回 transcript、日志或 diff 正文。',
      parameters: getTaskInput,
      async execute(input, ctx) {
        const parsed = getTaskInput.parse(input)
        const detail = getTaskDetail(deps.db, resolveTaskId(ctx.workspaceId, parsed.taskId))
        // 总管只能看到当前 workspace 的任务，避免跨工作区读取。
        if (!detail) {
          throw appError('task_not_found', 'task not found', { taskId: parsed.taskId })
        }
        const task = detail.task
        const attention = attentionFor(task.status, task.waitingReason)
        const injectable = canInjectContext(task)
        const sessions = listSessionsByTask(deps.db, task.id)
        const session = sessions.at(-1)
        const review = getReviewByTask(deps.db, task.id)
        const acceptance = listAcceptanceSummaries(deps.db, [task.id]).get(task.id) ?? null
        const usage = getTaskBudgetSummary(deps.db, task, {
          claudeMaxBudgetUsd: deps.claudeMaxBudgetUsd,
        })
        const acceptanceResponse = acceptance
          ? getAcceptanceResponse(deps.db, task, {
              claudeMaxBudgetUsd: deps.claudeMaxBudgetUsd,
              workspacesRoot: deps.workspacesRoot,
            })
          : null
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
          acceptance: acceptance
            ? {
                total: acceptance.counts.total,
                pass: acceptance.counts.pass,
                fail: acceptance.counts.fail,
                pending: acceptance.counts.pending,
                waived: acceptance.counts.waived,
                verdict: acceptance.verdict,
                topFailures: acceptance.topFailures,
              }
            : null,
          usage,
          report: acceptanceResponse
            ? {
                summary: truncateText(acceptanceResponse.report.result, 500),
                risks: acceptanceResponse.report.risks.slice(0, 5),
                unverified: acceptanceResponse.report.unverified.slice(0, 5),
              }
            : null,
          context: task.context
            ? {
                included: task.context.included.length,
                dropped: task.context.dropped.length,
                relations: task.context.relations.length,
                truncated: task.context.truncated || task.context.relationsTruncated,
                injections: {
                  count: task.context.injections.length,
                  lastAt: task.context.injections.at(-1)?.at ?? null,
                  lastSeq: task.context.injections.at(-1)?.seq ?? null,
                },
              }
            : null,
          injectable: {
            ok: injectable.ok,
            ...(injectable.reason ? { reason: injectable.reason } : {}),
          },
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
        const taskId = resolveTaskId(ctx.workspaceId, parsed.taskId)
        const detail = getTaskDetail(deps.db, taskId)
        if (!detail) {
          throw appError('task_not_found', 'task not found', { taskId: parsed.taskId })
        }
        const history = listTaskStatusHistory(deps.db, taskId, parsed.limit, parsed.beforeOrdinal)
        return {
          taskId,
          statusEvents: history.items,
          sessions: listSessionsByTask(deps.db, taskId)
            .slice(-20)
            .map((session) => ({
              id: session.id,
              status: session.status,
              outcome: session.outcome,
              startedAt: session.startedAt,
              endedAt: session.endedAt,
            })),
          reviews: listReviewsByTask(deps.db, taskId)
            .slice(0, 20)
            .map((review) => ({
              id: review.id,
              verdict: review.verdict,
              verifyExitCode: review.verifyExitCode,
              diffStat: review.diffStat,
              diffAvailable: review.diffAvailable,
              decidedAt: review.decidedAt,
            })),
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

    update_node: {
      description:
        '移动画布节点或重命名 Agent；只在用户明确要求“挪一下/放到旁边/改个名字”时使用。' +
        '不能删除节点、不能改文本内容、不能改分组。',
      parameters: updateNodeInput,
      async execute(input, ctx) {
        const parsed = updateNodeInput.parse(input)
        const canvas = canvasFor(ctx)
        const node = getNode(deps.db, parsed.nodeId)
        if (!node || node.canvasId !== canvas.id) {
          throw appError('node_not_found', 'node not found on this canvas', {
            nodeId: parsed.nodeId,
          })
        }
        if (parsed.title !== undefined && node.type !== 'agent') {
          throw appError('invalid_payload', 'only agent titles can be changed', {
            nodeId: node.id,
          })
        }
        const data =
          parsed.title !== undefined && node.type === 'agent'
            ? { ...(node.data as Record<string, unknown>), title: parsed.title }
            : undefined
        const hasPosition = parsed.x !== undefined || parsed.y !== undefined
        const nextX = parsed.x ?? node.x
        const nextY = parsed.y ?? node.y
        // group 只能带着子节点整体移动，否则框和内容会错位。
        const children =
          node.type === 'group' && hasPosition
            ? listNodes(deps.db, node.canvasId).filter((child) => child.groupId === node.id)
            : []
        const before = {
          ...(parsed.x !== undefined ? { x: node.x } : {}),
          ...(parsed.y !== undefined ? { y: node.y } : {}),
          ...(parsed.title !== undefined
            ? { title: (node.data as { title?: string }).title ?? null }
            : {}),
        }
        const after = {
          ...(parsed.x !== undefined ? { x: nextX } : {}),
          ...(parsed.y !== undefined ? { y: nextY } : {}),
          ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        }
        deps.db.transaction((tx) => {
          if (hasPosition) {
            const dx = nextX - node.x
            const dy = nextY - node.y
            moveNodes(
              tx,
              node.canvasId,
              [
                { nodeId: node.id, x: nextX, y: nextY },
                ...children.map((child) => ({
                  nodeId: child.id,
                  x: child.x + dx,
                  y: child.y + dy,
                })),
              ],
              deps.now(),
            )
          }
          if (data !== undefined) {
            updateNode(tx, node.id, { data, updatedAt: deps.now() })
          }
          insertAudit(tx, {
            id: deps.newId(),
            ts: deps.now(),
            actor: 'supervisor',
            action: 'supervisor.node.update',
            detail: {
              nodeId: node.id,
              workspaceId: ctx.workspaceId,
              fields: [
                ...(parsed.x !== undefined ? ['x'] : []),
                ...(parsed.y !== undefined ? ['y'] : []),
                ...(parsed.title !== undefined ? ['title'] : []),
              ],
              before,
              after,
              ...(children.length > 0 ? { childrenMoved: children.length } : {}),
            },
          })
        })
        const updated = getNode(deps.db, node.id)
        return {
          nodeId: node.id,
          x: updated?.x ?? node.x,
          y: updated?.y ?? node.y,
          ...(updated?.type === 'agent' ? { title: updated.data.title } : {}),
        }
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

        const created = createTaskForTool(ctx, {
          title: parsed.title,
          prompt: ctx.text,
          target,
          contextNodeIds,
          engine,
          workspaceMode: parsed.workspaceMode,
          start: parsed.start,
        })
        ctx.memo.taskId = created.taskId
        return {
          ...card(created.taskId, parsed.title, target, contextNodeIds.length, created.status),
          started: created.status === 'queued',
          ...(created.startError ? { startError: created.startError } : {}),
        }
      },
    },

    create_tasks: {
      description:
        '从 1-6 个文本节点批量创建任务；共享一个 Agent；默认全部待办；start=true 时才批量开工。',
      parameters: createTasksInput,
      async execute(input, ctx) {
        const parsed = createTasksInput.parse(input)
        if (parsed.nodeIds.length < 1 || parsed.nodeIds.length > 6) {
          throw appError('supervisor_batch_invalid', 'nodeIds must contain 1-6 ids', {
            nodeIds: parsed.nodeIds,
          })
        }
        if (parsed.nodeIds.length !== new Set(parsed.nodeIds).size) {
          throw appError('supervisor_batch_invalid', 'nodeIds must be unique', {
            nodeIds: parsed.nodeIds,
          })
        }
        const batchKey = JSON.stringify({
          nodeIds: [...parsed.nodeIds].sort(),
          targetNodeId: parsed.targetNodeId ?? null,
          contextNodeIds: parsed.contextNodeIds ?? [],
          engine: parsed.engine ?? null,
          start: parsed.start,
        })
        if (ctx.memo.batch?.key === batchKey) {
          return ctx.memo.batch.result as {
            created: SupervisorTaskCardValue[]
            failed: BatchFailure[]
          }
        }
        const canvas = canvasFor(ctx)
        const textNodes = parsed.nodeIds.map((id) => {
          const node = getNode(deps.db, id)
          if (
            !node ||
            node.canvasId !== canvas.id ||
            node.type !== 'text' ||
            !node.data.content.trim()
          ) {
            throw appError(
              'supervisor_batch_invalid',
              'all nodeIds must be non-empty text nodes on this canvas',
              { nodeIds: parsed.nodeIds, invalidNodeId: id },
            )
          }
          return node
        })
        const target = resolveAgentTarget(ctx, {
          title: textTitle(textNodes[0]!.data.content),
          ...(parsed.targetNodeId ? { targetNodeId: parsed.targetNodeId } : {}),
          ...(parsed.agentTitle ? { agentTitle: parsed.agentTitle } : {}),
          ...(parsed.engine ? { engine: parsed.engine } : {}),
        })
        const engine = resolveEngine(parsed.engine, target)
        const sharedContext = (parsed.contextNodeIds ?? ctx.selection.contextNodeIds).filter(
          (id) => !parsed.nodeIds.includes(id),
        )
        const contextNodeIds = resolveContext(ctx, sharedContext, target.id)

        const created: SupervisorTaskCardValue[] = []
        const failed: BatchFailure[] = []

        for (const node of textNodes) {
          const title = textTitle(node.data.content).slice(0, 80)
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
              title,
              prompt: node.data.content,
              contextNodeIds,
              engine,
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
                  engine,
                  createdAgent: target.created,
                  batch: true,
                  sourceNodeId: node.id,
                },
              },
            },
          )
          if (!result.ok) {
            failed.push({ nodeId: node.id, stage: 'create', error: result.error })
            continue
          }
          let status: 'todo' | 'queued' = 'todo'
          if (parsed.start) {
            const enqueued = deps.enqueueTask(result.taskId)
            if (enqueued.ok) status = 'queued'
            else failed.push({ nodeId: node.id, stage: 'enqueue', error: enqueued.error })
          }
          created.push(card(result.taskId, title, target, contextNodeIds.length, status))
        }

        audit('supervisor.task.batch', created[0]?.taskId ?? parsed.nodeIds[0]!, ctx, {
          nodeIds: parsed.nodeIds,
          createdTaskIds: created.map((item) => item.taskId),
          failed: failed.map((item) => item.nodeId),
          started: parsed.start,
        })
        if (created.length === 0) {
          throw appError('supervisor_batch_failed', 'no tasks were created', {
            nodeIds: parsed.nodeIds,
            failed: failed.map((item) => ({
              nodeId: item.nodeId,
              stage: item.stage,
              code: item.error.code,
            })),
          })
        }
        const batchResult = { created, failed }
        ctx.memo.batch = { key: batchKey, result: batchResult }
        return batchResult
      },
    },

    handoff_task: {
      description:
        '把一个已停下任务（review/done/failed/cancelled）的结果做成交接节点，并创建新任务继续；' +
        '默认待办，不自动开工；source 任务在 worktree 时会提示变更不可读。',
      parameters: handoffTaskInput,
      async execute(input, ctx) {
        const parsed = handoffTaskInput.parse(input)
        const fromTask = requireTask(ctx, parsed.fromTaskId)
        const title = (parsed.title ?? `跟进：${fromTask.title}`).slice(0, 80)
        const target = resolveAgentTarget(ctx, {
          title,
          ...(parsed.toNodeId ? { targetNodeId: parsed.toNodeId } : {}),
        })
        // 先校验目标与额外上下文，再落交接节点；避免失败时画布留下孤儿节点。
        const extraContext = resolveContext(ctx, ctx.selection.contextNodeIds, target.id)
        const handoff = createHandoffNode(
          {
            db: deps.db,
            workspacesRoot: deps.workspacesRoot,
            now: deps.now,
            newId: deps.newId,
            ...(deps.logger ? { logger: deps.logger } : {}),
          },
          { taskId: fromTask.id, workspaceId: ctx.workspaceId, actor: 'supervisor' },
        )
        if (!handoff.ok) throw handoff.error

        const engine = resolveEngine(undefined, target)
        const contextNodeIds = [...new Set([handoff.node.id, ...extraContext])]
        const created = createTaskForTool(ctx, {
          title,
          prompt: parsed.note ?? '基于交接结果继续完成后续工作。',
          target,
          contextNodeIds,
          engine,
          workspaceMode: 'main',
          start: parsed.start,
          auditDetail: {
            handoffNodeId: handoff.node.id,
            sourceTaskId: fromTask.id,
          },
        })
        audit('supervisor.task.handoff', created.taskId, ctx, {
          fromTaskId: fromTask.id,
          toTaskId: created.taskId,
          nodeId: handoff.node.id,
          handoffNodeId: handoff.node.id,
          hasNote: Boolean(parsed.note),
          started: created.status === 'queued',
        })
        return SupervisorHandoffResult.parse({
          task: card(created.taskId, title, target, contextNodeIds.length, created.status),
          handoff: {
            nodeId: handoff.node.id,
            fromTaskId: fromTask.id,
            fromTitle: fromTask.title,
            fromStatus: fromTask.status,
            worktree: fromTask.workspaceMode === 'worktree',
            warnings: handoff.summary.warnings,
          },
          ...(created.startError ? { startError: created.startError } : {}),
        })
      },
    },

    enqueue_task: {
      description: '把一个待办任务立即开工；只接受 todo 状态，验收仍由用户决定。',
      parameters: enqueueTaskInput,
      async execute(input, ctx) {
        const parsed = enqueueTaskInput.parse(input)
        const taskId = resolveTaskId(ctx.workspaceId, parsed.taskId)
        const detail = getTaskDetail(deps.db, taskId)
        if (!detail) {
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
        const outcome = deps.enqueueTask(detail.task.id)
        if (!outcome.ok) throw outcome.error
        return { taskId: detail.task.id, status: outcome.status }
      },
    },

    retry_task: {
      description: '重试一个失败任务；只有 failed 可用。note 用用户原话，写入 <feedback>。',
      parameters: retryTaskInput,
      async execute(input, ctx) {
        const parsed = retryTaskInput.parse(input)
        const task = requireTask(ctx, parsed.taskId)
        if (task.status !== 'failed') {
          throw appError('invalid_transition', 'only failed tasks can be retried', {
            taskId: task.id,
            status: task.status,
          })
        }
        const result = transitionResult(
          deps.applyTransition(task.id, {
            type: 'retry',
            ...(parsed.note ? { note: parsed.note } : {}),
          }),
        )
        audit('supervisor.task.retry', task.id, ctx, { hasNote: Boolean(parsed.note) })
        return result
      },
    },

    reopen_task: {
      description:
        '重开一个已完成/已取消的任务；start=true 时重开后立即开工。note 用用户原话，写入 <reopen_note>。',
      parameters: reopenTaskInput,
      async execute(input, ctx) {
        const parsed = reopenTaskInput.parse(input)
        const task = requireTask(ctx, parsed.taskId)
        if (task.status !== 'done' && task.status !== 'cancelled') {
          throw appError('invalid_transition', 'only done/cancelled tasks can be reopened', {
            taskId: task.id,
            status: task.status,
          })
        }
        const result = transitionResult(
          deps.applyTransition(task.id, {
            type: 'reopen',
            ...(parsed.note ? { note: parsed.note } : {}),
          }),
        )
        let status: TaskStatus = result.status
        let startError: string | undefined
        if (parsed.start) {
          const outcome = deps.enqueueTask(task.id)
          if (outcome.ok) status = outcome.status
          else startError = outcome.error.message
        }
        audit('supervisor.task.reopen', task.id, ctx, {
          hasNote: Boolean(parsed.note),
          started: Boolean(parsed.start && !startError),
        })
        return {
          ok: true,
          taskId: task.id,
          status,
          ...(startError ? { startError } : {}),
        }
      },
    },

    cancel_task: {
      description: '取消一个非终态任务；运行中任务需要 confirm=true。reason 用用户原话，可选。',
      parameters: cancelTaskInput,
      async execute(input, ctx) {
        const parsed = cancelTaskInput.parse(input)
        const task = requireTask(ctx, parsed.taskId)
        if (task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') {
          throw appError('invalid_transition', 'terminal tasks cannot be cancelled', {
            taskId: task.id,
            status: task.status,
          })
        }
        if (task.status === 'running' && !parsed.confirm) {
          throw appError('confirmation_required', 'task is running; confirm before cancelling', {
            taskId: task.id,
            status: task.status,
          })
        }
        const result = transitionResult(deps.cancelTask(task.id, parsed.reason))
        audit('supervisor.task.cancel', task.id, ctx, { hasReason: Boolean(parsed.reason) })
        return result
      },
    },

    reply_task: {
      description:
        '回复一个等待输入的任务；只转发用户原话，不处理审批。审批请让用户在任务详情/审批卡处理。',
      parameters: replyTaskInput,
      async execute(input, ctx) {
        const parsed = replyTaskInput.parse(input)
        const task = requireTask(ctx, parsed.taskId)
        const result = deps.replyToTask(task.id, parsed.text)
        if (!result.ok) throw result.error
        audit('supervisor.task.reply', task.id, ctx, { length: parsed.text.length })
        return { ok: true, taskId: task.id, status: 'running' }
      },
    },

    inject_context: {
      description:
        '把画布节点补投给一个已有任务；只在用户明确说“补给它/把这几个节点给它”时使用。' +
        '一次只处理一个任务；review 状态只能让用户去打回。',
      parameters: injectContextInput,
      async execute(input, ctx) {
        const parsed = injectContextInput.parse(input)
        const task = requireTask(ctx, parsed.taskId)
        const result = deps.injectContext({
          taskId: task.id,
          nodeIds: parsed.nodeIds,
          ...(parsed.note ? { note: parsed.note } : {}),
          source: 'supervisor',
          actor: 'supervisor',
        })
        if (!result.ok) throw result.error
        return {
          taskId: result.taskId,
          seq: result.seq,
          truncated: result.truncated,
          dropped: result.dropped,
        }
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
