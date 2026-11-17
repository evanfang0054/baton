import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TestApp } from './helpers/app.js'
import { buildTestApp } from './helpers/app.js'
import { updateTaskState } from '../src/db/repositories.js'

const apps: TestApp[] = []
const auth = { authorization: 'Bearer secret' }

async function setup(): Promise<TestApp> {
  const app = await buildTestApp({ config: { token: 'secret' } })
  apps.push(app)
  return app
}

afterEach(async () => {
  const current = apps.splice(0)
  await Promise.all(current.map((app) => app.app.close()))
  await Promise.all(current.map((app) => app.handle.cleanup()))
})

describe('REST API', () => {
  it('keeps health public and requires auth for other API routes', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/workspaces' })).statusCode).toBe(401)
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/workspaces',
          headers: auth,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/workspaces',
          headers: { cookie: 'baton_token=secret' },
        })
      ).statusCode,
    ).toBe(200)
  })

  it('creates a workspace with a canvas and rejects duplicates', async () => {
    const { app, handle } = await setup()
    mkdirSync(join(handle.root, 'new-ws'))

    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: { name: 'new', relPath: 'new-ws' },
    })
    expect(created.statusCode).toBe(201)
    const body = created.json() as {
      workspace: { id: string; relPath: string }
      canvas: { workspaceId: string }
    }
    expect(body.workspace.relPath).toBe('new-ws')
    expect(body.canvas.workspaceId).toBe(body.workspace.id)

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: { name: 'new', relPath: 'new-ws' },
    })
    expect(duplicate.statusCode).toBe(409)

    const escaped = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: { name: 'escape', relPath: '../escape' },
    })
    expect(escaped.statusCode).toBe(400)
  })

  it('returns 400 for malformed JSON instead of 500', async () => {
    const { app } = await setup()
    const response = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: { ...auth, 'content-type': 'application/json' },
      payload: '{"name":',
    })
    expect(response.statusCode).toBe(400)
    expect((response.json() as { code: string }).code).toBe('invalid_payload')
  })

  it('reads canvas, tasks and task detail', async () => {
    const { app, handle } = await setup()
    const canvas = await app.inject({
      method: 'GET',
      url: `/api/canvas?workspaceId=${handle.seeded.workspaceId}`,
      headers: auth,
    })
    expect(canvas.statusCode).toBe(200)
    expect((canvas.json() as { nodes: unknown[] }).nodes).toHaveLength(2)

    const tasks = await app.inject({
      method: 'GET',
      url: `/api/tasks?workspaceId=${handle.seeded.workspaceId}`,
      headers: auth,
    })
    expect(tasks.statusCode).toBe(200)
    const taskList = tasks.json() as {
      tasks: Array<{ attention: string; waitingSince: number | null }>
    }
    expect(taskList.tasks).toHaveLength(1)
    expect(taskList.tasks[0]?.attention).toBe('none')
    expect(taskList.tasks[0]?.waitingSince).toBeNull()

    // fixture 造 waiting 态，走 repository 单一写入口。
    handle.database.db.transaction((tx) =>
      updateTaskState(tx, handle.seeded.taskId, 'waiting_input', 0, 'question', 42),
    )

    const waitingTasks = await app.inject({
      method: 'GET',
      url: `/api/tasks?workspaceId=${handle.seeded.workspaceId}`,
      headers: auth,
    })
    expect(waitingTasks.statusCode).toBe(200)
    const waitingBody = waitingTasks.json() as {
      tasks: Array<{ attention: string; waitingSince: number | null }>
    }
    expect(waitingBody.tasks[0]?.attention).toBe('needs_reply')
    expect(waitingBody.tasks[0]?.waitingSince).toBe(42)

    const detail = await app.inject({
      method: 'GET',
      url: `/api/tasks/${handle.seeded.taskId}`,
      headers: auth,
    })
    expect(detail.statusCode).toBe(200)
    const detailBody = detail.json() as {
      review: unknown
      waitingSince: unknown
      attention: unknown
      task: { waitingReason: unknown }
    }
    expect(detailBody.review).toBeNull()
    expect(detailBody.waitingSince).toBe(42)
    expect(detailBody.attention).toBe('needs_reply')
    expect(detailBody.task.waitingReason).toBe('question')

    const missing = await app.inject({
      method: 'GET',
      url: '/api/tasks/missing',
      headers: auth,
    })
    expect(missing.statusCode).toBe(404)
  })

  it('returns needs_review for review tasks', async () => {
    const { app, handle } = await setup()
    handle.database.db.transaction((tx) =>
      updateTaskState(tx, handle.seeded.taskId, 'review', 0, null, 43),
    )

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks?workspaceId=${handle.seeded.workspaceId}`,
      headers: auth,
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as {
      tasks: Array<{ attention: string; waitingSince: number | null }>
    }
    expect(body.tasks[0]?.attention).toBe('needs_review')
    expect(body.tasks[0]?.waitingSince).toBe(43)
  })

  it('returns session events history', async () => {
    const { app, handle } = await setup()
    if (!handle.seeded.sessionId) throw new Error('expected session')
    handle.database.raw
      .prepare(
        `insert into event (id, session_id, ordinal, seq, type, payload_json, ts)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'event-1',
        handle.seeded.sessionId,
        1,
        1,
        'RUN_STARTED',
        JSON.stringify({ type: 'RUN_STARTED' }),
        1,
      )
    handle.database.raw
      .prepare(
        `insert into event (id, session_id, ordinal, seq, type, payload_json, ts)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'event-2',
        handle.seeded.sessionId,
        2,
        2,
        'RUN_FINISHED',
        JSON.stringify({ type: 'RUN_FINISHED' }),
        2,
      )

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${handle.seeded.sessionId}/events?sinceSeq=0&limit=10`,
      headers: auth,
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as {
      sessionId: string
      events: Array<{ seq: number; type: string; payload: unknown; ts: number }>
      nextSeq: number
      hasMore: boolean
    }
    expect(body.sessionId).toBe(handle.seeded.sessionId)
    expect(body.events).toEqual([
      { seq: 1, type: 'RUN_STARTED', payload: { type: 'RUN_STARTED' }, ts: 1 },
      { seq: 2, type: 'RUN_FINISHED', payload: { type: 'RUN_FINISHED' }, ts: 2 },
    ])
    expect(body.nextSeq).toBe(2)
    expect(body.hasMore).toBe(false)

    const page = await app.inject({
      method: 'GET',
      url: `/api/sessions/${handle.seeded.sessionId}/events?sinceSeq=1&limit=1`,
      headers: auth,
    })
    const pageBody = page.json() as {
      events: Array<{ seq: number }>
      nextSeq: number
      hasMore: boolean
    }
    expect(pageBody.events.map((event) => event.seq)).toEqual([2])
    expect(pageBody.nextSeq).toBe(2)
    expect(pageBody.hasMore).toBe(false)

    const empty = await app.inject({
      method: 'GET',
      url: `/api/sessions/${handle.seeded.sessionId}/events?sinceSeq=2&limit=1`,
      headers: auth,
    })
    const emptyBody = empty.json() as { events: unknown[]; nextSeq: number; hasMore: boolean }
    expect(emptyBody.events).toEqual([])
    expect(emptyBody.nextSeq).toBe(2)
    expect(emptyBody.hasMore).toBe(false)

    const missing = await app.inject({
      method: 'GET',
      url: '/api/sessions/missing/events',
      headers: auth,
    })
    expect(missing.statusCode).toBe(404)

    const invalid = await app.inject({
      method: 'GET',
      url: `/api/sessions/${handle.seeded.sessionId}/events?limit=0`,
      headers: auth,
    })
    expect(invalid.statusCode).toBe(400)
  })
})
