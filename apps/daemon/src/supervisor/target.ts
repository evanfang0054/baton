import { Engine, Node, type Engine as EngineValue } from '@baton/protocol'
import { getCanvasByWorkspace, getNode, insertNode, listNodes } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'

export interface TargetContext {
  workspaceId: string
  selection: {
    contextNodeIds: string[]
    targetNodeId?: string
    agentCandidates: Array<{ id: string; title: string; engine: string }>
  }
  memo: {
    createdNodeIds?: string[]
  }
}

export interface TargetResolverDeps {
  db: Db
  defaultEngine: EngineValue
  now: () => number
  newId: () => string
}

const CONTENT_TYPES = new Set(['text', 'file', 'image'])

/** 建单前解析目标 Agent 与上下文；tools 与 plan apply 共用，避免复制画布规则。 */
export function createTargetResolver(deps: TargetResolverDeps) {
  function canvasFor(ctx: TargetContext) {
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
    ctx: TargetContext,
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
    ctx: TargetContext,
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
    ctx: TargetContext,
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

  function resolveContext(ctx: TargetContext, requested: string[], targetId: string): string[] {
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
    return target.engine
  }

  return {
    canvasFor,
    insertCanvasNode,
    createAgentNode,
    resolveAgentTarget,
    resolveContext,
    resolveEngine,
  }
}
