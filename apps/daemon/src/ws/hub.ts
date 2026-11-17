import { WebSocket } from 'ws'
import type { BroadcastEvent } from '../db/event-store.js'

export interface WsHub {
  register(socket: WebSocket): void
  broadcast(event: BroadcastEvent): void
  close(): void
}

const MAX_BUFFERED = 8 * 1024 * 1024

export function createWsHub(): WsHub {
  const sockets = new Set<WebSocket>()

  return {
    register(socket) {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    },
    broadcast(event) {
      const frame = JSON.stringify({
        v: 1,
        id: event.id,
        type: event.type,
        ts: event.ts,
        seq: event.ordinal,
        payload: event.payload,
      })
      for (const socket of sockets) {
        if (socket.readyState !== WebSocket.OPEN) continue
        if (socket.bufferedAmount > MAX_BUFFERED) {
          socket.close(1013, 'slow client')
          continue
        }
        socket.send(frame)
      }
    },
    close() {
      for (const socket of sockets) socket.close(1001, 'server closing')
      sockets.clear()
    },
  }
}
