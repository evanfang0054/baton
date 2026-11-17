import type { ServerMessage } from '@baton/protocol'
import type { WsStatus } from '../stores/app'

interface WsClientOptions {
  onStatus: (status: WsStatus) => void
  onEvent: (event: ServerMessage) => void
}

export function createWsClient(options: WsClientOptions) {
  let socket: WebSocket | null = null
  let closed = false
  let retry = 0
  let timer: number | undefined
  let lastSeq = 0

  const sendResume = () => {
    if (socket?.readyState !== WebSocket.OPEN) return
    socket.send(
      JSON.stringify({
        v: 1,
        id: crypto.randomUUID(),
        type: 'resume',
        ts: Date.now(),
        payload: { sinceSeq: lastSeq },
      }),
    )
  }

  const schedule = () => {
    retry += 1
    const delay = Math.min(5000, 1000 * 2 ** (retry - 1))
    timer = window.setTimeout(connect, delay)
  }

  const connect = () => {
    options.onStatus(retry === 0 ? 'connecting' : 'reconnecting')
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    socket.addEventListener('open', () => {
      retry = 0
      options.onStatus('online')
      sendResume()
    })
    socket.addEventListener('message', (message) => {
      try {
        const parsed = JSON.parse(String(message.data)) as {
          seq?: number
          type?: string
          payload?: unknown
        }
        if (typeof parsed.seq === 'number') lastSeq = parsed.seq
        if (parsed.type && parsed.type !== 'ack' && parsed.type !== 'pong') {
          options.onEvent(parsed as ServerMessage)
        }
      } catch {
        // 非法消息不影响后续事件；daemon 仍会继续推送。
      }
    })
    socket.addEventListener('close', () => {
      if (closed) return
      options.onStatus('offline')
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
