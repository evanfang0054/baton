import { AuditListQuery, AuditListResponse } from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import { listAudit } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'

export function registerAuditRoutes(app: FastifyInstance, deps: { db: Db }): void {
  app.get('/api/audit', async (req) => {
    const parsed = AuditListQuery.safeParse(req.query)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid audit query', parsed.error.issues)
    }
    const entries = listAudit(deps.db, parsed.data)
    const nextBefore =
      entries.length === parsed.data.limit ? (entries.at(-1)?.ts ?? undefined) : undefined
    return AuditListResponse.parse({
      entries,
      ...(nextBefore !== undefined ? { nextBefore } : {}),
    })
  })
}
