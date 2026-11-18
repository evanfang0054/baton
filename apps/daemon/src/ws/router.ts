import { AckEvent, ClientMessage, ErrorEvent, WsEnvelope, WsPong } from '@baton/protocol'
import type { WebSocket } from 'ws'
import type { Runtime } from '../runtime/index.js'
import { sendSafely } from './send.js'

const REPLAY_BATCH = 200

function send(socket: WebSocket, message: unknown): boolean {
  return sendSafely(socket, JSON.stringify(message))
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

  async function handle(socket: WebSocket, raw: string): Promise<void> {
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

    let outcome: ReturnType<Runtime['handleCommand']>
    try {
      outcome = runtime.handleCommand(message.data)
    } catch {
      // 单条命令的内部异常不能打掉整条 WS；客户端应收到 error 并保持连接。
      sendError(socket, envelope.data.id, 'internal_error', 'internal error')
      return
    }
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
      for (let index = 0; index < outcome.replay.length; index += 1) {
        const event = outcome.replay[index]!
        const sent = send(socket, {
          v: 1,
          id: event.id,
          type: event.type,
          ts: event.ts,
          seq: event.ordinal,
          payload: event.payload,
        })
        if (!sent) {
          return
        }
        if (index % REPLAY_BATCH === REPLAY_BATCH - 1) {
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
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
