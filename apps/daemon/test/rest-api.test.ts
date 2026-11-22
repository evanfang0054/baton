import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiffSnapshot, Review } from '@baton/protocol'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'
import type { TestApp } from './helpers/app.js'
import { buildTestApp } from './helpers/app.js'
import { insertReview, updateReviewDiff, updateTaskState } from '../src/db/repositories.js'
import { createWorktree } from '../src/workspace/worktree.js'

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

    const absoluteDir = join(handle.root, 'absolute-ws')
    mkdirSync(absoluteDir)
    const absolute = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: { name: 'absolute', relPath: absoluteDir },
    })
    expect(absolute.statusCode).toBe(201)
    expect((absolute.json() as { workspace: { relPath: string } }).workspace.relPath).toBe(
      'absolute-ws',
    )

    const outside = mkdtempSync(join(tmpdir(), 'baton-outside-'))
    try {
      const outsideResponse = await app.inject({
        method: 'POST',
        url: '/api/workspaces',
        headers: auth,
        payload: { name: 'outside', relPath: outside },
      })
      expect(outsideResponse.statusCode).toBe(400)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('browses workspace directories and rejects path escapes', async () => {
    const { app, handle } = await setup()
    mkdirSync(join(handle.root, 'demo-project', '.git'), { recursive: true })

    const listed = await app.inject({
      method: 'GET',
      url: '/api/workspaces/browse',
      headers: auth,
    })
    expect(listed.statusCode).toBe(200)
    const body = listed.json() as {
      entries: Array<{ name: string; relPath: string; hasGit: boolean }>
    }
    expect(body.entries).toContainEqual({
      name: 'demo-project',
      relPath: 'demo-project',
      hasGit: true,
    })

    const searched = await app.inject({
      method: 'GET',
      url: '/api/workspaces/browse?q=demo',
      headers: auth,
    })
    expect(searched.statusCode).toBe(200)
    const searchEntries = (searched.json() as { entries: Array<{ name: string; relPath: string }> })
      .entries
    expect(searchEntries).toContainEqual(
      expect.objectContaining({ name: 'demo-project', relPath: 'demo-project' }),
    )
    expect(searchEntries.every((entry) => entry.name.toLowerCase().includes('demo'))).toBe(true)

    const escaped = await app.inject({
      method: 'GET',
      url: '/api/workspaces/browse?path=../outside',
      headers: auth,
    })
    expect(escaped.statusCode).toBe(400)
    expect((escaped.json() as { code: string }).code).toBe('invalid_path')
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

  it('returns only the failure summary in task detail', async () => {
    const { app, handle } = await setup()
    handle.database.raw
      .prepare(
        `insert into task_failure (
           id, workspace_id, task_id, session_id, attempt, stage, last_error,
           retryable, affected_paths_json, summary, created_at
         ) values ('f1', ?, ?, null, 0, 'verify', 'exit 3', 1, '["src/login.ts"]', '校验未通过', 7)`,
      )
      .run(handle.seeded.workspaceId, handle.seeded.taskId)

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${handle.seeded.taskId}`,
      headers: auth,
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { lastFailure: Record<string, unknown> }
    expect(body.lastFailure).toEqual({
      stage: 'verify',
      lastError: 'exit 3',
      retryable: true,
      affectedPaths: ['src/login.ts'],
      summary: '校验未通过',
      createdAt: 7,
    })
    expect(body.lastFailure).not.toHaveProperty('id')
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

  it('returns context snapshots only on task detail and degrades invalid JSON', async () => {
    const { app, handle } = await setup()
    const snapshot = {
      included: [{ id: 'n1', type: 'text', title: '需求', depth: 0, chars: 6 }],
      dropped: [],
      truncated: false,
      redactedPaths: [],
      relations: [],
      relationsTruncated: false,
      injections: [],
    }

    const list = await app.inject({
      method: 'GET',
      url: `/api/tasks?workspaceId=${handle.seeded.workspaceId}`,
      headers: auth,
    })
    const listBody = list.json() as { tasks: Array<Record<string, unknown>> }
    expect(listBody.tasks[0]).not.toHaveProperty('context')

    const oldDetail = await app.inject({
      method: 'GET',
      url: `/api/tasks/${handle.seeded.taskId}`,
      headers: auth,
    })
    const oldBody = oldDetail.json() as { task: { context: unknown }; contextInvalid: boolean }
    expect(oldBody.task.context).toBeNull()
    expect(oldBody.contextInvalid).toBe(false)

    handle.database.raw
      .prepare('update task set context_json = ? where id = ?')
      .run(JSON.stringify(snapshot), handle.seeded.taskId)
    const withSnapshot = await app.inject({
      method: 'GET',
      url: `/api/tasks/${handle.seeded.taskId}`,
      headers: auth,
    })
    const snapshotBody = withSnapshot.json() as {
      task: { context: unknown }
      contextInvalid: boolean
    }
    expect(snapshotBody.task.context).toEqual(snapshot)
    expect(snapshotBody.contextInvalid).toBe(false)

    handle.database.raw
      .prepare('update task set context_json = ? where id = ?')
      .run('{', handle.seeded.taskId)
    const invalid = await app.inject({
      method: 'GET',
      url: `/api/tasks/${handle.seeded.taskId}`,
      headers: auth,
    })
    expect(invalid.statusCode).toBe(200)
    const invalidBody = invalid.json() as { task: { context: unknown }; contextInvalid: boolean }
    expect(invalidBody.task.context).toBeNull()
    expect(invalidBody.contextInvalid).toBe(true)
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

  it('returns review diff snapshots and marks diffAvailable', async () => {
    const { app, handle } = await setup()
    const review: Review = {
      id: 'r-diff',
      taskId: handle.seeded.taskId,
      verdict: null,
      verifyExitCode: 0,
      verifyOutput: 'ok',
      diffStat: { filesChanged: 1, insertions: 1, deletions: 0 },
      decidedAt: null,
      preliminaryVerdict: null,
      preliminaryReason: null,
      preliminaryAt: null,
    }
    const snapshot: DiffSnapshot = {
      v: 1,
      capturedAt: 1,
      baseRef: 'HEAD',
      truncated: false,
      files: [
        {
          path: 'a.txt',
          status: 'modified',
          insertions: 1,
          deletions: 0,
          patch: '@@ -1 +1 @@\n-old\n+new',
        },
      ],
    }
    handle.database.db.transaction((tx) => insertReview(tx, review))
    updateReviewDiff(handle.database.db, review.id, snapshot)

    const diff = await app.inject({
      method: 'GET',
      url: `/api/reviews/${review.id}/diff`,
      headers: auth,
    })
    expect(diff.statusCode).toBe(200)
    expect((diff.json() as { snapshot: DiffSnapshot }).snapshot.files[0]?.path).toBe('a.txt')

    const detail = await app.inject({
      method: 'GET',
      url: `/api/tasks/${handle.seeded.taskId}`,
      headers: auth,
    })
    expect((detail.json() as { review: { diffAvailable: boolean } }).review.diffAvailable).toBe(
      true,
    )

    const missing = await app.inject({
      method: 'GET',
      url: '/api/reviews/missing/diff',
      headers: auth,
    })
    expect(missing.statusCode).toBe(404)

    const oldReview: Review = { ...review, id: 'r-old' }
    handle.database.db.transaction((tx) => insertReview(tx, oldReview))
    const unavailable = await app.inject({
      method: 'GET',
      url: `/api/reviews/${oldReview.id}/diff`,
      headers: auth,
    })
    expect(unavailable.statusCode).toBe(404)
    expect((unavailable.json() as { code: string }).code).toBe('diff_unavailable')
  })

  it('returns task history with status events and reviews', async () => {
    const { app, handle } = await setup()
    handle.runtime.applyTransition(handle.seeded.taskId, { type: 'enqueue' })

    const review: Review = {
      id: 'r-history',
      taskId: handle.seeded.taskId,
      verdict: null,
      verifyExitCode: 0,
      verifyOutput: 'ok',
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      decidedAt: null,
      preliminaryVerdict: null,
      preliminaryReason: null,
      preliminaryAt: null,
    }
    const snapshot: DiffSnapshot = {
      v: 1,
      capturedAt: 1,
      baseRef: 'HEAD',
      truncated: false,
      files: [],
    }
    handle.database.db.transaction((tx) => insertReview(tx, review))
    updateReviewDiff(handle.database.db, review.id, snapshot)

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${handle.seeded.taskId}/history?limit=10`,
      headers: auth,
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as {
      statusEvents: Array<{ ordinal: number; status: string }>
      sessions: unknown[]
      reviews: Array<{ id: string; diffAvailable: boolean }>
    }
    expect(body.statusEvents.some((event) => event.status === 'queued')).toBe(true)
    expect(body.reviews[0]).toMatchObject({ id: 'r-history', diffAvailable: true })

    const latest = body.statusEvents[0]!.ordinal
    const page = await app.inject({
      method: 'GET',
      url: `/api/tasks/${handle.seeded.taskId}/history?limit=10&beforeOrdinal=${latest}`,
      headers: auth,
    })
    const pageBody = page.json() as { statusEvents: Array<{ ordinal: number }> }
    expect(pageBody.statusEvents.some((event) => event.ordinal === latest)).toBe(false)
  })

  it('cleans a worktree but keeps the branch and reports capabilities', async () => {
    const { app, handle } = await setup()
    const workspace = join(handle.root, handle.seeded.relPath)

    const before = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${handle.seeded.workspaceId}/capabilities`,
      headers: auth,
    })
    expect(before.json()).toEqual({ worktree: false })

    await execa('git', ['-C', workspace, 'init', '-q'])
    await execa('git', ['-C', workspace, 'config', 'user.email', 'test@example.com'])
    await execa('git', ['-C', workspace, 'config', 'user.name', 'test'])
    await execa('git', ['-C', workspace, 'commit', '--allow-empty', '-qm', 'init'])

    const after = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${handle.seeded.workspaceId}/capabilities`,
      headers: auth,
    })
    expect(after.json()).toEqual({ worktree: true })

    const created = await createWorktree({
      dataDir: handle.root,
      workspacePath: workspace,
      taskId: handle.seeded.taskId,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    handle.database.raw
      .prepare(
        "update task set status = 'review', workspace_mode = 'worktree', worktree_path = ? where id = ?",
      )
      .run(created.path, handle.seeded.taskId)

    const cleanup = await app.inject({
      method: 'POST',
      url: `/api/tasks/${handle.seeded.taskId}/worktree/cleanup`,
      headers: auth,
    })
    expect(cleanup.statusCode).toBe(200)
    expect(existsSync(created.path)).toBe(false)
    expect(
      (
        handle.database.raw
          .prepare('select worktree_path from task where id = ?')
          .get(handle.seeded.taskId) as { worktree_path: string | null }
      ).worktree_path,
    ).toBeNull()
    const branch = await execa('git', [
      '-C',
      workspace,
      'branch',
      '--list',
      `baton/${handle.seeded.taskId}`,
    ])
    expect(branch.stdout).toContain(`baton/${handle.seeded.taskId}`)

    handle.database.raw
      .prepare("update task set status = 'queued' where id = ?")
      .run(handle.seeded.taskId)
    const queued = await app.inject({
      method: 'POST',
      url: `/api/tasks/${handle.seeded.taskId}/worktree/cleanup`,
      headers: auth,
    })
    expect(queued.statusCode).toBe(409)
    expect((queued.json() as { code: string }).code).toBe('task_active')

    handle.database.raw
      .prepare("update task set status = 'running' where id = ?")
      .run(handle.seeded.taskId)
    const active = await app.inject({
      method: 'POST',
      url: `/api/tasks/${handle.seeded.taskId}/worktree/cleanup`,
      headers: auth,
    })
    expect(active.statusCode).toBe(409)
    expect((active.json() as { code: string }).code).toBe('task_active')
  })
})
