import { SessionEventsQuery, SessionEventsResponse } from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import { getSession, listSessionEvents } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'

export function registerSessionRoutes(app: FastifyInstance, deps: { db: Db }): void {
  app.get('/api/sessions/:id/events', async (req) => {
    const params = req.params as { id?: string }
    if (!params.id) {
      throw appError('invalid_payload', 'session id is required')
    }
    const parsed = SessionEventsQuery.safeParse(req.query)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid session events query', parsed.error.issues)
    }
    const session = getSession(deps.db, params.id)
    if (!session) {
      throw appError('session_not_found', 'session not found', { sessionId: params.id })
    }
    const result = listSessionEvents(deps.db, params.id, parsed.data.sinceSeq, parsed.data.limit)
    const nextSeq = result.rows.at(-1)?.seq ?? parsed.data.sinceSeq
    return SessionEventsResponse.parse({
      sessionId: params.id,
      events: result.rows,
      nextSeq,
      hasMore: result.hasMore,
    })
  })
}
