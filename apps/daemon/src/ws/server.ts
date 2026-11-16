import websocket from '@fastify/websocket'
import { WsEnvelope } from '@baton/protocol'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import type { Config } from '../config.js'

function tokenFromRequest(req: FastifyRequest): string | null {
  const url = new URL(req.url, 'http://localhost')
  const query = url.searchParams.get('token')
  if (query) return query
  const authorization = req.headers.authorization
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice(7)
  }
  const cookie = req.headers.cookie
  const raw =
    typeof cookie === 'string' ? cookie.match(/(?:^|;\s*)baton_token=([^;]+)/)?.[1] : undefined
  return raw ? decodeURIComponent(raw) : null
}

export async function attachWs(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(websocket)
  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    const timer = setTimeout(() => socket.close(4401, 'unauthorized'), 5000)
    const supplied = tokenFromRequest(req)
    if (config.token && supplied !== config.token) return
    clearTimeout(timer)
    socket.on('close', () => clearTimeout(timer))
    socket.on('message', (raw) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(raw))
      } catch {
        socket.close(4400, 'invalid json')
        return
      }
      const envelope = WsEnvelope.safeParse(parsed)
      if (!envelope.success) {
        socket.close(4400, 'invalid envelope')
        return
      }
      if (envelope.data.type === 'ping') {
        socket.send(
          JSON.stringify({
            v: 1,
            type: 'pong',
            id: envelope.data.id,
            ts: Date.now(),
            payload: {},
          }),
        )
      }
    })
  })
}
