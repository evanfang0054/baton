import { WebSocket } from 'ws'

export const MAX_BUFFERED = 8 * 1024 * 1024

/**
 * 所有 WS 发送的唯一出口：同时处理 readyState、慢客户端与 send 异常。
 * 慢客户端直接 1013 关闭，避免 replay 把内存与事件循环拖死。
 */
export function sendSafely(socket: WebSocket, data: string): boolean {
  if (socket.readyState !== WebSocket.OPEN) {
    return false
  }
  if (socket.bufferedAmount > MAX_BUFFERED) {
    socket.close(1013, 'slow client')
    return false
  }
  try {
    socket.send(data)
    return true
  } catch {
    socket.terminate()
    return false
  }
}
