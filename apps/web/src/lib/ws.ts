import { ClientMessage, ServerMessage, WsEnvelope } from '@baton/protocol'
import type { WsStatus } from '../stores/app'

interface WsClientOptions {
  onStatus: (status: WsStatus) => void
  onEvent: (event: ServerMessage) => void
}

const FATAL_CLOSE_CODES = new Set([4400, 4401, 4403])

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // 非安全上下文没有 randomUUID；命令 id 只需在本连接内唯一。
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function createWsClient(options: WsClientOptions) {
  let socket: WebSocket | null = null
  let closed = false
  let hasOpened = false
  let retry = 0
  let timer: number | undefined
  let lastSeq = 0

  const sendResume = () => {
    if (socket?.readyState !== WebSocket.OPEN) return
    const message: ClientMessage = ClientMessage.parse({
      v: 1,
      id: createId(),
      type: 'resume',
      ts: Date.now(),
      payload: lastSeq > 0 ? { sinceSeq: lastSeq } : {},
    })
    socket.send(JSON.stringify(message))
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
      const isReconnect = hasOpened
      hasOpened = true
      retry = 0
      options.onStatus('online')
      // 首次连接不需要回放：REST 已经给出当前快照。
      if (isReconnect) sendResume()
    })
    socket.addEventListener('message', (message) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(message.data))
      } catch {
        return
      }
      const envelope = WsEnvelope.safeParse(parsed)
      if (!envelope.success) return
      const event = ServerMessage.safeParse(envelope.data)
      if (!event.success) return
      if (typeof event.data.seq === 'number') lastSeq = event.data.seq
      if (event.data.type === 'ack') {
        handleAck(event.data)
        return
      }
      options.onEvent(event.data)
    })
    socket.addEventListener('close', (event) => {
      if (closed) return
      options.onStatus('offline')
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
      socket?.close()
    },
    lastSeq: () => lastSeq,
  }
}
