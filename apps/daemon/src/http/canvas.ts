import { CanvasQuery, CanvasResponse } from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import { getCanvasByWorkspace, listEdges, listNodes } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'

export function registerCanvasRoutes(app: FastifyInstance, deps: { db: Db }): void {
  app.get('/api/canvas', async (req) => {
    const parsed = CanvasQuery.safeParse(req.query)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid canvas query', parsed.error.issues)
    }
    const canvas = getCanvasByWorkspace(deps.db, parsed.data.workspaceId)
    if (!canvas) {
      throw appError('canvas_not_found', 'canvas not found', {
        workspaceId: parsed.data.workspaceId,
      })
    }
    return CanvasResponse.parse({
      canvas,
      nodes: listNodes(deps.db, canvas.id),
      edges: listEdges(deps.db, canvas.id),
    })
  })
}
