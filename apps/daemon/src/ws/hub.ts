import type { WebSocket } from 'ws'
import type { BroadcastEvent } from '../db/event-store.js'
import { sendSafely } from './send.js'

export interface WsHub {
  register(socket: WebSocket): void
  broadcast(event: BroadcastEvent): void
  close(): void
}

export function buildWsFrame(event: BroadcastEvent): string {
  return `{"v":1,"id":${JSON.stringify(event.id)},"type":${JSON.stringify(event.type)},"ts":${event.ts},"seq":${event.ordinal},"payload":${event.payloadJson}}`
}

export function createWsHub(): WsHub {
  const sockets = new Set<WebSocket>()

  return {
    register(socket) {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    },
    broadcast(event) {
      const frame = buildWsFrame(event)
      for (const socket of sockets) {
        sendSafely(socket, frame)
      }
    },
    close() {
      for (const socket of sockets) {
        socket.close(1001, 'server closing')
      }
      sockets.clear()
    },
  }
}
