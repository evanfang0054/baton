import { Edge, type AppError, type EdgeCreateInput, type EdgeDeleteInput } from '@baton/protocol'
import type { Db } from '../db/types.js'
import { deleteEdgeById, findEdge, getEdge, getNode, insertEdge } from '../db/repositories.js'
import { appError, toAppError } from '../errors.js'

export interface EdgeServiceDeps {
  db: Db
  newId: () => string
}

export type EdgeResult = { ok: true; edgeId: string } | { ok: false; error: AppError }

export function createEdge(deps: EdgeServiceDeps, input: EdgeCreateInput): EdgeResult {
  try {
    const source = getNode(deps.db, input.sourceId)
    const target = getNode(deps.db, input.targetId)
    const missing = [...(source ? [] : [input.sourceId]), ...(target ? [] : [input.targetId])]
    if (!source || !target) {
      return {
        ok: false,
        error: appError('node_not_found', 'edge endpoint not found', { nodeIds: missing }),
      }
    }
    if (source.canvasId !== target.canvasId) {
      return {
        ok: false,
        error: appError('edge_cross_canvas', 'edge endpoints must share a canvas', {
          sourceId: source.id,
          targetId: target.id,
        }),
      }
    }
    if (source.id === target.id) {
      return {
        ok: false,
        error: appError('edge_self_loop', 'an edge cannot point to itself', {
          nodeId: source.id,
        }),
      }
    }
    if (
      findEdge(deps.db, {
        canvasId: source.canvasId,
        sourceId: source.id,
        targetId: target.id,
        type: input.type,
      })
    ) {
      return {
        ok: false,
        error: appError('edge_duplicate', 'edge already exists', {
          sourceId: source.id,
          targetId: target.id,
        }),
      }
    }

    const edgeId = deps.newId()
    deps.db.transaction((tx) =>
      insertEdge(
        tx,
        Edge.parse({
          id: edgeId,
          canvasId: source.canvasId,
          sourceId: source.id,
          targetId: target.id,
          type: input.type,
        }),
      ),
    )
    return { ok: true, edgeId }
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' && String(error).includes('edge.')) {
      return { ok: false, error: appError('edge_duplicate', 'edge already exists') }
    }
    return { ok: false, error: toAppError(error) }
  }
}

export function deleteEdge(
  deps: Pick<EdgeServiceDeps, 'db'>,
  input: EdgeDeleteInput,
): { ok: true } | { ok: false; error: AppError } {
  try {
    const existing = getEdge(deps.db, input.edgeId)
    if (!existing) {
      return {
        ok: false,
        error: appError('edge_not_found', 'edge not found', { edgeId: input.edgeId }),
      }
    }
    deps.db.transaction((tx) => deleteEdgeById(tx, existing.id))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: toAppError(error) }
  }
}
