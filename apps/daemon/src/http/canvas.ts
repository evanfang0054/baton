import { CanvasQuery, CanvasResponse } from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import { getCanvasByDelivery } from '../db/delivery-repositories.js'
import { getCanvasByWorkspace, listEdges, listNodes } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'

export function registerCanvasRoutes(app: FastifyInstance, deps: { db: Db }): void {
  app.get('/api/canvas', async (req) => {
    const parsed = CanvasQuery.safeParse(req.query)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid canvas query', parsed.error.issues)
    }
    const canvas = parsed.data.deliveryId
      ? getCanvasByDelivery(deps.db, parsed.data.deliveryId)
      : getCanvasByWorkspace(deps.db, parsed.data.workspaceId)
    if (!canvas || canvas.workspaceId !== parsed.data.workspaceId) {
      throw appError('canvas_not_found', 'canvas not found', {
        workspaceId: parsed.data.workspaceId,
        ...(parsed.data.deliveryId ? { deliveryId: parsed.data.deliveryId } : {}),
      })
    }
    return CanvasResponse.parse({
      canvas,
      nodes: listNodes(deps.db, canvas.id),
      edges: listEdges(deps.db, canvas.id),
    })
  })
}
