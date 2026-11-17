import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import type { Config } from '../config.js'
import { tokenFromRequest, tokensEqual } from '../http/token.js'
import type { Runtime } from '../runtime/index.js'
import type { WsHub } from './hub.js'
import { createWsRouter } from './router.js'

function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) {
    return true
  }
  try {
    return host !== undefined && new URL(origin).host === host
  } catch {
    return false
  }
}

export async function attachWs(
  app: FastifyInstance,
  config: Config,
  runtime: Runtime,
  hub: WsHub,
): Promise<void> {
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } })
  const router = createWsRouter(runtime)

  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    // 浏览器跨站 WebSocket 必须校验 Origin，本地无 token 时这是唯一防线。
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      socket.close(4403, 'origin not allowed')
      return
    }
    const supplied = tokenFromRequest(req)
    if (config.token && !tokensEqual(supplied, config.token)) {
      socket.close(4401, 'unauthorized')
      return
    }
    hub.register(socket)
    socket.on('message', (raw) => {
      void router.handle(socket, String(raw)).catch(() => socket.close(1011, 'internal error'))
    })
  })
}
