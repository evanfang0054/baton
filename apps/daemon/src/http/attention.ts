import { AttentionInboxQuery, AttentionInboxResponse } from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import type { AttentionService } from '../attention/service.js'
import { appError } from '../errors.js'

export function registerAttentionRoutes(
  app: FastifyInstance,
  deps: { attention: AttentionService },
): void {
  app.get('/api/attention', async (req) => {
    const query = AttentionInboxQuery.safeParse(req.query)
    if (!query.success) {
      throw appError('invalid_payload', 'invalid attention query', query.error.issues)
    }
    const result = deps.attention.list(query.data.limit)
    return AttentionInboxResponse.parse(result)
  })
}
