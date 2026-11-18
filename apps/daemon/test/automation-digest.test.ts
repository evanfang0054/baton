import { describe, expect, it } from 'vitest'
import { getSetting, listNotices } from '../src/db/repositories.js'
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
    await waitFor(() => handle.events.some((event) => event.type === 'notice'))
  })
})
