import type { TaskCreateInput } from '@baton/protocol'
import { buildTestApp, type TestApp } from './app.js'
import type { TestRuntimeHandle } from './runtime.js'
import { WsClient } from './ws-client.js'

export interface WsTestApp extends TestApp {
  ws: WsClient
  url: string
}

/** 建立带真实端口的测试 app 与已连接的 WS 客户端。 */
export async function createWsTestApp(
  options: Parameters<typeof buildTestApp>[0] = {},
): Promise<WsTestApp> {
  const app = await buildTestApp(options)
  await app.app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.app.server.address()
  if (!address || typeof address === 'string') {
    throw new Error('no port')
  }
  const url = `ws://127.0.0.1:${address.port}/ws`
  const ws = new WsClient(url)
  await ws.open()
  return { ...app, ws, url }
}

export function createTaskPayload(
  handle: TestRuntimeHandle,
  overrides: Partial<TaskCreateInput> = {},
): TaskCreateInput {
  return {
    workspaceId: handle.seeded.workspaceId,
    nodeId: handle.seeded.nodeId,
    title: 'demo',
    prompt: '把登录页改成暗黑模式',
    contextNodeIds: ['text-1'],
    engine: 'fake',
    workspaceMode: 'main',
    ...overrides,
  }
}
