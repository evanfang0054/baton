import type { DigestReport } from '@baton/protocol'
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

  it('adds one attention item per task and does not advance the window for attention digests', () => {
    const handle = setup()
    handle.database.raw
      .prepare(
        "update task set status='waiting_input', waiting_reason='approval', updated_at=10 where id=?",
      )
      .run(handle.seeded.taskId)
    const first = handle.runtime.digest.generate(handle.seeded.workspaceId, 'manual')
    const firstPayload = first?.payload as {
      windowEnd: number
      attention: { items: Array<{ kind: string }>; counts: { approval: number } }
    }
    expect(firstPayload.attention.items.map((item) => item.kind)).toEqual(['approval'])
    expect(firstPayload.attention.counts.approval).toBe(1)

    const attention = handle.runtime.digest.generate(handle.seeded.workspaceId, 'attention')
    const attentionPayload = attention?.payload as { windowStart: number; windowEnd: number }
    expect(attentionPayload.windowStart).toBe(firstPayload.windowEnd)
    expect(
      getSetting(handle.database.db, `digest:last:${handle.seeded.workspaceId}`),
    ).toMatchObject({ at: firstPayload.windowEnd })
  })

  it('delivers the digest into the supervisor chat with an attention snapshot', () => {
    const handle = setup()
    handle.database.raw
      .prepare(
        "update task set status='waiting_input', waiting_reason='approval', updated_at=10 where id=?",
      )
      .run(handle.seeded.taskId)

    const notice = handle.runtime.digest.generate(handle.seeded.workspaceId, 'manual')
    const history = handle.runtime.supervisor.history(handle.seeded.workspaceId, 10)
    expect(history.messages).toHaveLength(1)
    const message = history.messages[0]!
    expect(message.role).toBe('assistant')
    expect(message.content).toContain('本轮汇报')
    expect(message.content).toContain('需要你决定 1 件')
    expect(message.meta?.digest?.noticeId).toBe(notice?.id)
    expect(message.meta?.digest?.trigger).toBe('manual')
    expect(message.meta?.digest?.items).toHaveLength(1)
    expect(message.meta?.digest?.items[0]?.action).toEqual({ type: 'open_task' })
  })

  it('dedupes repeated delivery for the same notice', () => {
    const handle = setup()
    const notice = handle.runtime.digest.generate(handle.seeded.workspaceId, 'manual')
    const report = notice?.payload as DigestReport

    handle.runtime.supervisor.deliverDigest({
      workspaceId: handle.seeded.workspaceId,
      notice: notice!,
      report,
      trigger: 'manual',
    })
    expect(handle.runtime.supervisor.history(handle.seeded.workspaceId, 10).messages).toHaveLength(
      1,
    )
  })
})
