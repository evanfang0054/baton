import { afterEach, describe, expect, it } from 'vitest'
import type { TaskAcceptanceSummary, TaskBudgetSummary } from '@baton/protocol'
import type { TestApp } from './helpers/app.js'
import { buildTestApp } from './helpers/app.js'

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

function enterReview(handle: TestApp['handle']): void {
  const taskId = handle.seeded.taskId
  handle.runtime.applyTransition(taskId, { type: 'enqueue' })
  handle.runtime.applyTransition(taskId, { type: 'start' })
  handle.runtime.applyTransition(taskId, { type: 'completed' })
  handle.runtime.applyTransition(taskId, {
    type: 'verify_ok',
    reviewId: 'r1',
    exitCode: 0,
    output: 'ok',
    diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
  })
}

describe('acceptance REST', () => {
  it('requires auth and returns not_found without a contract', async () => {
    const { app, handle } = await setup()
    expect((await app.inject({ method: 'GET', url: '/api/tasks/x/acceptance' })).statusCode).toBe(
      401,
    )
    const missingTask = await app.inject({
      method: 'GET',
      url: '/api/tasks/missing/acceptance',
      headers: auth,
    })
    expect(missingTask.statusCode).toBe(404)
    expect(missingTask.json()).toMatchObject({ code: 'task_not_found' })

    const missing = await app.inject({
      method: 'GET',
      url: `/api/tasks/${handle.seeded.taskId}/acceptance`,
      headers: auth,
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toMatchObject({ code: 'acceptance_not_found' })
  })

  it('exposes acceptance and budget on the task list', async () => {
    const { app, handle } = await setup()
    const listUrl = `/api/tasks?workspaceId=${handle.seeded.workspaceId}`
    const before = await app.inject({ method: 'GET', url: listUrl, headers: auth })
    expect(before.statusCode).toBe(200)
    const beforeTask = (
      before.json() as {
        tasks: Array<{ acceptance: TaskAcceptanceSummary | null; budget: TaskBudgetSummary }>
      }
    ).tasks[0]
    expect(beforeTask?.acceptance).toBeNull()
    expect(beforeTask?.budget).toMatchObject({ budgetUsd: 2, spentUsd: 0, overBudget: false })

    enterReview(handle)
    const after = await app.inject({ method: 'GET', url: listUrl, headers: auth })
    const afterTask = (
      after.json() as {
        tasks: Array<{ acceptance: TaskAcceptanceSummary | null; budget: TaskBudgetSummary }>
      }
    ).tasks[0]
    expect(afterTask?.acceptance).toMatchObject({
      version: 1,
      status: 'draft',
      counts: { total: 0, pass: 0, fail: 0, pending: 0, waived: 0 },
      verdict: 'incomplete',
    })
  })

  it('returns the derived acceptance report for a review task', async () => {
    const { app, handle } = await setup()
    enterReview(handle)

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${handle.seeded.taskId}/acceptance`,
      headers: auth,
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as {
      contract: { id: string; version: number; status: string }
      items: unknown[]
      run: { reviewId: string; status: string } | null
      report: { hash: string; goal: string; taskId: string; acceptance: { counts: unknown } }
    }
    expect(body.contract).toMatchObject({ version: 1, status: 'draft' })
    expect(body.items).toEqual([])
    expect(body.run).toMatchObject({ reviewId: 'r1', status: 'running' })
    expect(body.report).toMatchObject({
      taskId: handle.seeded.taskId,
      goal: 'demo',
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })
})
