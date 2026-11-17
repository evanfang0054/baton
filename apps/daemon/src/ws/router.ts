import { AckEvent, ClientMessage, ErrorEvent, WsEnvelope, WsPong } from '@baton/protocol'
import type { WebSocket } from 'ws'
import type { Runtime } from '../runtime/index.js'

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState !== socket.OPEN) return
  socket.send(JSON.stringify(message))
}

export function createWsRouter(runtime: Runtime) {
  function sendError(
    socket: WebSocket,
    commandId: string | undefined,
    code: string,
    message: string,
    details?: unknown,
  ): void {
    const event = ErrorEvent.parse({
      v: 1,
      type: 'error',
      ts: Date.now(),
      payload: {
        ...(commandId ? { commandId } : {}),
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    })
    send(socket, event)
  }

  function handle(socket: WebSocket, raw: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
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
      const id = envelope.data.id ?? 'ping'
      const pong = WsPong.parse({ type: 'pong', id, ts: Date.now() })
      send(socket, {
        v: 1,
        type: 'pong',
        id: pong.id,
        ts: pong.ts,
        payload: pong,
      })
      return
    }

    const message = ClientMessage.safeParse(envelope.data)
    if (!message.success) {
      sendError(
        socket,
        envelope.data.id,
        'invalid_payload',
        'invalid command',
        message.error.issues,
      )
      return
    }

    const outcome = runtime.handleCommand(message.data)
    if (!outcome.ok) {
      sendError(
        socket,
        envelope.data.id,
        outcome.error.code,
        outcome.error.message,
        outcome.error.details,
      )
      return
    }

    if (outcome.replay) {
      for (const event of outcome.replay) {
        send(socket, {
          v: 1,
          id: event.id,
          type: event.type,
          ts: event.ts,
          seq: event.ordinal,
          payload: event.payload,
        })
      }
    }

    const ack = AckEvent.parse({
      v: 1,
      type: 'ack',
      ts: Date.now(),
      payload: {
        commandId: envelope.data.id ?? message.data.id,
        ok: true,
        data: outcome.ack,
      },
    })
    send(socket, ack)
  }

  return { handle }
}
