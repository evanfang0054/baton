import { NoticeListQuery, NoticeListResponse } from '@baton/protocol'
import type { FastifyInstance } from 'fastify'
import { listNotices, markNoticeRead } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'

export function registerNoticeRoutes(
  app: FastifyInstance,
  deps: { db: Db; now: () => number },
): void {
  app.get('/api/notices', async (req) => {
    const parsed = NoticeListQuery.safeParse(req.query)
    if (!parsed.success) {
      throw appError('invalid_payload', 'invalid notice query', parsed.error.issues)
    }
    const notices = listNotices(deps.db, parsed.data)
    const nextBefore =
      notices.length === parsed.data.limit ? (notices.at(-1)?.ts ?? undefined) : undefined
    return NoticeListResponse.parse({
      notices,
      ...(nextBefore !== undefined ? { nextBefore } : {}),
    })
  })

  app.post('/api/notices/:id/read', async (req) => {
    const { id } = req.params as { id?: string }
    if (!id) throw appError('invalid_payload', 'notice id is required')
    const updated = deps.db.transaction((tx) => markNoticeRead(tx, id, deps.now()))
    if (!updated) throw appError('notice_not_found', 'notice not found', { noticeId: id })
    return { ok: true }
  })
}
