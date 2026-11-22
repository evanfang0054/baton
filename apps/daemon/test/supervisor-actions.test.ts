import { afterEach, describe, expect, it } from 'vitest'
import { appError } from '../src/errors.js'
import { createSupervisorActionService } from '../src/supervisor/actions.js'
import { createTestDb, seedTask, type TestDb } from './helpers/db.js'

const dbs: TestDb[] = []
afterEach(() => dbs.splice(0).forEach((entry) => entry.raw.close()))

function setup(options: { failMandate?: boolean } = {}) {
  const database = createTestDb()
  dbs.push(database)
  const seeded = seedTask(database.raw, { taskStatus: 'failed' })
  let now = 1_000
  let id = 0
  const transitions: string[] = []
  const service = createSupervisorActionService({
    db: database.db,
    now: () => now,
    newId: () => `action-${++id}`,
    policyVersion: () => 'policy-1',
    requireMandate: () =>
      options.failMandate ? appError('mandate_revoked', 'mandate revoked') : null,
    applyTransition: (taskId, event) => {
      transitions.push(`${taskId}:${event.type}`)
      return {
        ok: true,
        taskId,
        status: 'queued',
        previousStatus: 'failed',
        retryCount: 1,
        waitingReason: null,
        events: [],
      }
    },
    enqueueTask: () => ({ ok: true, status: 'queued' }),
  })
  return { database, seeded, service, transitions, setNow: (value: number) => (now = value) }
}

const base = (taskId: string) => ({
  threadId: 'thread-1',
  taskId,
  kind: 'retry' as const,
  strength: 'inferred' as const,
  mode: 'observe' as const,
  reason: '任务失败，建议重试',
  payload: { taskId },
  policyVersion: 'policy-1',
  mandateVersion: 'mandate-1',
  dedupeKey: `retry:${taskId}:1`,
})

describe('supervisor action service', () => {
  it('proposing observe does not touch task state and dedupes', () => {
    const { seeded, service, transitions } = setup()
    const first = service.propose({ ...base(seeded.taskId), workspaceId: seeded.workspaceId })
    const second = service.propose({ ...base(seeded.taskId), workspaceId: seeded.workspaceId })
    expect(first.ok).toBe(true)
    expect(second.ok && second.duplicate).toBe(true)
    expect(transitions).toEqual([])
    expect(service.listProposed(seeded.workspaceId)).toHaveLength(1)
  })

  it('applies only as human, and writes applied', () => {
    const { seeded, service, transitions } = setup()
    const proposed = service.propose({ ...base(seeded.taskId), workspaceId: seeded.workspaceId })
    if (!proposed.ok) throw new Error(proposed.error.message)
    const forbidden = service.decide({
      workspaceId: seeded.workspaceId,
      actionId: proposed.action.id,
      actor: 'supervisor',
      decision: 'apply',
    })
    expect(forbidden).toMatchObject({ ok: false, error: { code: 'supervisor_action_forbidden' } })
    const applied = service.decide({
      workspaceId: seeded.workspaceId,
      actionId: proposed.action.id,
      actor: 'human',
      decision: 'apply',
    })
    expect(applied.ok).toBe(true)
    expect(transitions).toEqual([`${seeded.taskId}:retry`])
    expect(service.get(proposed.action.id)?.status).toBe('applied')
  })

  it('marks an action failed when the mandate is revoked at apply time', () => {
    const { seeded, service, transitions } = setup({ failMandate: true })
    const proposed = service.propose({ ...base(seeded.taskId), workspaceId: seeded.workspaceId })
    if (!proposed.ok) throw new Error(proposed.error.message)
    const applied = service.decide({
      workspaceId: seeded.workspaceId,
      actionId: proposed.action.id,
      actor: 'human',
      decision: 'apply',
    })
    expect(applied).toMatchObject({ ok: false, error: { code: 'mandate_revoked' } })
    expect(service.get(proposed.action.id)?.status).toBe('failed')
    expect(transitions).toEqual([])
  })

  it('expires proposed actions and refuses reuse', () => {
    const { seeded, service, setNow } = setup()
    const proposed = service.propose({ ...base(seeded.taskId), workspaceId: seeded.workspaceId })
    if (!proposed.ok) throw new Error(proposed.error.message)
    setNow(proposed.action.expiresAt)
    expect(service.expire()).toBe(1)
    const applied = service.decide({
      workspaceId: seeded.workspaceId,
      actionId: proposed.action.id,
      actor: 'human',
      decision: 'apply',
    })
    expect(applied).toMatchObject({ ok: false, error: { code: 'action_expired' } })
  })

  it('cleans proposed after 7 days and terminal after 30 days', () => {
    const first = setup()
    const proposed = first.service.propose({
      ...base(first.seeded.taskId),
      workspaceId: first.seeded.workspaceId,
    })
    if (!proposed.ok) throw new Error(proposed.error.message)
    first.setNow(proposed.action.createdAt + 7 * 24 * 60 * 60 * 1000 + 1)
    expect(first.service.cleanup()).toBe(1)

    const second = setup()
    const ignored = second.service.propose({
      ...base(second.seeded.taskId),
      workspaceId: second.seeded.workspaceId,
    })
    if (!ignored.ok) throw new Error(ignored.error.message)
    second.service.decide({
      workspaceId: second.seeded.workspaceId,
      actionId: ignored.action.id,
      actor: 'human',
      decision: 'ignore',
    })
    second.setNow(ignored.action.createdAt + 30 * 24 * 60 * 60 * 1000 + 1)
    expect(second.service.cleanup()).toBe(1)
  })
})
