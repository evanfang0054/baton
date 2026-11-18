import { ClientMessage, ServerMessage, WsEnvelope } from '@baton/protocol'
import type { WsStatus } from '../stores/app'

interface WsClientOptions {
  onStatus: (status: WsStatus) => void
  onEvent: (event: ServerMessage) => void
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type CommandInput = DistributiveOmit<ClientMessage, 'v' | 'id' | 'ts'>

export class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'CommandError'
  }
}

const FATAL_CLOSE_CODES = new Set([4400, 4401, 4403])
const COMMAND_TIMEOUT_MS = 10_000

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // 非安全上下文没有 randomUUID；命令 id 只需在本连接内唯一。
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * session.event 是热路径；只做字段级检查即可直接交给 transcript 投影。
 * 控制消息仍走完整 ServerMessage 校验，保持边界严格。
 */
export function parseIncomingMessage(raw: unknown): ServerMessage | null {
  const envelope = WsEnvelope.safeParse(raw)
  if (!envelope.success) return null
  if (envelope.data.type === 'session.event') {
    const payload = envelope.data.payload as
      { sessionId?: unknown; seq?: unknown; event?: { type?: unknown } } | undefined
    if (
      typeof payload?.sessionId !== 'string' ||
      typeof payload.seq !== 'number' ||
      typeof payload.event?.type !== 'string'
    ) {
      return null
    }
    return envelope.data as unknown as ServerMessage
  }
  const event = ServerMessage.safeParse(envelope.data)
  return event.success ? event.data : null
}

export function createWsClient(options: WsClientOptions) {
  let socket: WebSocket | null = null
  let closed = false
  let retry = 0
  let timer: number | undefined
  let lastSeq = 0
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }
  >()

  const rejectPending = (error: Error) => {
    for (const [id, entry] of pending) {
      window.clearTimeout(entry.timer)
      entry.reject(error)
      pending.delete(id)
    }
  }

  const sendResume = () => {
    if (socket?.readyState !== WebSocket.OPEN) return
    const message: ClientMessage = ClientMessage.parse({
      v: 1,
      id: createId(),
      type: 'resume',
      ts: Date.now(),
      payload: { sinceSeq: lastSeq },
    })
    socket.send(JSON.stringify(message))
  }

  const sendCommand = (input: CommandInput): Promise<unknown> => {
    if (socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new CommandError('ws_offline', 'WebSocket 未连接'))
    }
    const message: ClientMessage = ClientMessage.parse({
      ...input,
      v: 1,
      id: createId(),
      ts: Date.now(),
    })
    return new Promise((resolve, reject) => {
      const commandTimer = window.setTimeout(() => {
        pending.delete(message.id)
        reject(new CommandError('ack_timeout', '命令 10 秒内未确认'))
      }, COMMAND_TIMEOUT_MS)
      pending.set(message.id, { resolve, reject, timer: commandTimer })
      try {
        socket!.send(JSON.stringify(message))
      } catch (cause) {
        window.clearTimeout(commandTimer)
        pending.delete(message.id)
        reject(
          new CommandError(
            'ws_send_failed',
            cause instanceof Error ? cause.message : '命令发送失败',
          ),
        )
      }
    })
  }

  const schedule = () => {
    retry += 1
    const delay = Math.min(5000, 1000 * 2 ** (retry - 1))
    timer = window.setTimeout(connect, delay)
  }

  const handleAck = (event: Extract<ServerMessage, { type: 'ack' }>) => {
    const data = event.payload.data
    if (!data || typeof data !== 'object') return
    const { cursor, hasMore } = data as { cursor?: unknown; hasMore?: unknown }
    if (typeof cursor === 'number' && cursor > lastSeq) lastSeq = cursor
    if (hasMore === true) sendResume()
  }

  const connect = () => {
    options.onStatus(retry === 0 ? 'connecting' : 'reconnecting')
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    socket.addEventListener('open', () => {
      retry = 0
      options.onStatus('online')
      // 首次连接也从 0 回放，补上 REST 快照到 socket open 之间的事件。
      sendResume()
    })
    socket.addEventListener('message', (message) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(message.data))
      } catch {
        return
      }
      const event = parseIncomingMessage(parsed)
      if (!event) return
      if ('seq' in event && typeof event.seq === 'number') lastSeq = event.seq
      if (event.type === 'ack') {
        const entry = pending.get(event.payload.commandId)
        if (entry) {
          window.clearTimeout(entry.timer)
          pending.delete(event.payload.commandId)
          entry.resolve(event.payload.data)
          return
        }
        handleAck(event)
        return
      }
      if (event.type === 'error') {
        const commandId = event.payload.commandId
        const entry = commandId ? pending.get(commandId) : undefined
        if (entry && commandId) {
          window.clearTimeout(entry.timer)
          pending.delete(commandId)
          entry.reject(
            new CommandError(event.payload.code, event.payload.message, event.payload.details),
          )
          return
        }
      }
      options.onEvent(event)
    })
    socket.addEventListener('close', (event) => {
      if (closed) return
      rejectPending(new CommandError('ws_closed', '连接已断开'))
      options.onStatus(event.code === 4401 ? 'unauthorized' : 'offline')
      if (FATAL_CLOSE_CODES.has(event.code)) return
      schedule()
    })
    socket.addEventListener('error', () => socket?.close())
  }

  connect()

  return {
    close: () => {
      closed = true
      if (timer) window.clearTimeout(timer)
      rejectPending(new CommandError('ws_closed', '连接已关闭'))
      socket?.close()
    },
    lastSeq: () => lastSeq,
    sendCommand,
  }
}
