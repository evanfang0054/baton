import { afterEach, describe, expect, it } from 'vitest'
import { createEngineRegistry } from '../src/runtime/engines.js'
import { buildTestApp, type TestApp } from './helpers/app.js'

const apps: TestApp[] = []
const auth = { authorization: 'Bearer secret' }

async function setup(
  engines = createEngineRegistry({
    env: { ANTHROPIC_API_KEY: 'set' },
    sdkMeta: () => ({ available: true, version: 'test' }),
  }),
): Promise<TestApp> {
  const app = await buildTestApp({
    config: { token: 'secret' },
    engines,
  })
  apps.push(app)
  return app
}

afterEach(async () => {
  const current = apps.splice(0)
  await Promise.all(current.map((app) => app.app.close()))
  await Promise.all(current.map((app) => app.handle.cleanup()))
})

describe('engine API', () => {
  it('requires auth and lists claude without calling a model', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: '/api/engines' })).statusCode).toBe(401)
    const response = await app.inject({ method: 'GET', url: '/api/engines', headers: auth })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { engines: Array<{ engine: string; status: string }> }
    expect(body.engines.map((entry) => entry.engine)).toEqual(['claude-sdk'])
    expect(body.engines.find((entry) => entry.engine === 'claude-sdk')?.status).toBe('available')
  })

  it('blocks enqueue when the selected engine is unavailable', async () => {
    const { handle } = await setup(
      createEngineRegistry({
        env: {},
        sdkMeta: () => ({ available: false, version: null }),
      }),
    )
    const taskId = handle.createTask({ engine: 'claude-sdk' })
    const outcome = handle.runtime.enqueue(taskId)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('engine_unavailable')
    }
    expect(handle.runtime.getTask(taskId)?.status).toBe('todo')
  })
})
