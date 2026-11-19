import { describe, expect, it } from 'vitest'
import { getSetting, listAudit, listNotices } from '../src/db/repositories.js'
import { waitFor } from './helpers/async.js'
import { createTestRuntime } from './helpers/runtime.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(): TestRuntimeHandle {
  const handle = createTestRuntime({ trusted: true })
  handles.push(handle)
  return handle
}

describe('digest service', () => {
  it('creates a notice, updates last_digest_at and broadcasts', async () => {
    const handle = setup()
    const notice = handle.runtime.digest.generate(handle.seeded.workspaceId, 'manual')
    expect(notice?.kind).toBe('digest')
    expect(notice?.workspaceId).toBe(handle.seeded.workspaceId)
    expect(notice?.payload).toMatchObject({ workspaceId: handle.seeded.workspaceId })

    expect(
      listNotices(handle.database.db, { workspaceId: handle.seeded.workspaceId, limit: 10 }),
    ).toHaveLength(1)
    expect(
      getSetting(handle.database.db, `digest:last:${handle.seeded.workspaceId}`),
    ).toMatchObject({ at: expect.any(Number) })
    expect(
      listAudit(handle.database.db, { actionPrefix: 'automation.digest.generate', limit: 10 }),
    ).toHaveLength(1)
    await waitFor(() => handle.events.some((event) => event.type === 'notice'))
  })

  it('skips scheduled digests for empty workspaces', () => {
    const handle = setup()
    handle.database.raw.prepare('delete from session where task_id = ?').run(handle.seeded.taskId)
    handle.database.raw.prepare('delete from task where id = ?').run(handle.seeded.taskId)
    expect(handle.runtime.digest.generate(handle.seeded.workspaceId, 'schedule')).toBeNull()
  })

  it('uses the persisted last digest as the next window start', () => {
    const handle = setup()
    const first = handle.runtime.digest.generate(handle.seeded.workspaceId, 'manual')
    const second = handle.runtime.digest.generate(handle.seeded.workspaceId, 'manual')
    const firstPayload = first?.payload as { windowStart: number; windowEnd: number }
    const secondPayload = second?.payload as { windowStart: number; windowEnd: number }
    expect(secondPayload.windowStart).toBe(firstPayload.windowEnd)
  })
})
