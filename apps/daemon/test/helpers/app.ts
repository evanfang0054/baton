import pino from 'pino'
import { buildApp } from '../../src/app.js'
import { createWsHub } from '../../src/ws/hub.js'
import { createTestRuntime, type TestRuntimeHandle } from './runtime.js'

export interface TestApp {
  app: Awaited<ReturnType<typeof buildApp>>
  handle: TestRuntimeHandle
  hub: ReturnType<typeof createWsHub>
}

export async function buildTestApp(
  options: Parameters<typeof createTestRuntime>[0] = {},
): Promise<TestApp> {
  const hub = createWsHub()
  const handle = createTestRuntime({
    ...options,
    broadcast: (event) => hub.broadcast(event),
  })
  const logger = pino({ level: 'silent' })
  const app = await buildApp(handle.config, {
    db: handle.database.db,
    runtime: handle.runtime,
    hub,
    logger,
    now: handle.now,
    newId: handle.newId,
  })
  return { app, handle, hub }
}
