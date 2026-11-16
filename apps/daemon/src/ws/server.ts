import websocket from '@fastify/websocket'
import { WsEnvelope, WsPong } from '@baton/protocol'
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
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

export async function attachWs(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } })
  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    const supplied = tokenFromRequest(req)
    if (config.token && supplied !== config.token) {
      socket.close(4401, 'unauthorized')
      return
    }
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
        const pong = WsPong.parse({
          type: 'pong',
          id: envelope.data.id ?? '',
          ts: Date.now(),
        })
        socket.send(
          JSON.stringify({
            v: 1,
            type: 'pong',
            id: pong.id,
            ts: pong.ts,
            payload: pong,
          }),
        )
      }
    })
  })
}
