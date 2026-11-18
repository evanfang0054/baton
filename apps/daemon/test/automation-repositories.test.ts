import { describe, expect, it } from 'vitest'
import {
  getSetting,
  insertAudit,
  insertNotice,
  listAudit,
  listNotices,
  markNoticeRead,
  setSetting,
} from '../src/db/repositories.js'
import { createTestDb, seedTask } from './helpers/db.js'

describe('automation repositories', () => {
  it('stores settings and upserts values', () => {
    const { db } = createTestDb()
    expect(getSetting(db, 'kill_switch')).toBeNull()
    db.transaction((tx) => setSetting(tx, 'kill_switch', { enabled: true }, 10))
    expect(getSetting(db, 'kill_switch')).toEqual({ enabled: true })
    db.transaction((tx) => setSetting(tx, 'kill_switch', { enabled: false }, 20))
    expect(getSetting(db, 'kill_switch')).toEqual({ enabled: false })
  })

  it('lists notices by workspace and marks read', () => {
    const { db, raw } = createTestDb()
    const seeded = seedTask(raw)
    db.transaction((tx) => {
      insertNotice(tx, {
        id: 'n1',
        workspaceId: seeded.workspaceId,
        ts: 20,
        kind: 'digest',
        payload: { ready: 1 },
      })
      insertNotice(tx, {
        id: 'n2',
        workspaceId: null,
        ts: 10,
        kind: 'system',
        payload: {},
      })
    })

    expect(listNotices(db, { workspaceId: seeded.workspaceId, limit: 10 })).toHaveLength(1)
    expect(listNotices(db, { limit: 10 }).map((notice) => notice.id)).toEqual(['n1', 'n2'])

    db.transaction((tx) => markNoticeRead(tx, 'n1', 30))
    expect(listNotices(db, { workspaceId: seeded.workspaceId, limit: 10 })[0]?.readAt).toBe(30)
  })

  it('filters and paginates audit entries', () => {
    const { db } = createTestDb()
    db.transaction((tx) => {
      insertAudit(tx, {
        id: 'a1',
        ts: 1,
        actor: 'user',
        action: 'automation.policy.update',
        detail: {},
      })
      insertAudit(tx, {
        id: 'a2',
        ts: 2,
        actor: 'user',
        action: 'automation.kill_switch',
        detail: {},
      })
      insertAudit(tx, { id: 'a3', ts: 3, actor: 'system', action: 'task.retry', detail: {} })
    })

    expect(listAudit(db, { actionPrefix: 'automation.', limit: 10 })).toHaveLength(2)
    expect(listAudit(db, { actionPrefix: 'automation.', limit: 1, before: 2 })[0]?.id).toBe('a1')
  })
})
