import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import type { Config } from '../config.js'
import { tokenFromRequest } from '../http/token.js'
import type { Runtime } from '../runtime/index.js'
import type { WsHub } from './hub.js'
import { createWsRouter } from './router.js'

export async function attachWs(
  app: FastifyInstance,
  config: Config,
  runtime: Runtime,
  hub: WsHub,
): Promise<void> {
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } })
  const router = createWsRouter(runtime)

  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    const supplied = tokenFromRequest(req)
    if (config.token && supplied !== config.token) {
      socket.close(4401, 'unauthorized')
      return
    }
    hub.register(socket)
    socket.on('message', (raw) => {
      router.handle(socket, String(raw))
    })
  })
}
