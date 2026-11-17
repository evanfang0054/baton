import { EventEmitter } from 'node:events'
import WebSocket from 'ws'

interface WsMessage {
  type: string
  [key: string]: unknown
}

export class WsClient {
  private readonly socket: WebSocket
  private readonly messages: WsMessage[] = []
  private readonly emitter = new EventEmitter()
  private readonly closePromise: Promise<number>

  constructor(url: string) {
    this.socket = new WebSocket(url)
    this.socket.on('message', (data) => {
      this.messages.push(JSON.parse(String(data)) as WsMessage)
      this.emitter.emit('message')
    })
    this.socket.on('error', () => {})
    this.closePromise = new Promise((resolve) => {
      this.socket.once('close', (code) => resolve(code))
    })
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState === WebSocket.OPEN) {
        resolve()
        return
      }
      this.socket.once('open', resolve)
      this.socket.once('error', reject)
    })
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message))
  }

  sendRaw(raw: string): void {
    this.socket.send(raw)
  }

  async next(type?: string, timeoutMs = 3000): Promise<WsMessage> {
    while (true) {
      const index = type
        ? this.messages.findIndex((message) => message.type === type)
        : this.messages.length > 0
          ? 0
          : -1
      if (index >= 0) return this.messages.splice(index, 1)[0]!
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.emitter.off('message', onMessage)
          reject(new Error(`timeout waiting for ${type ?? 'message'}`))
        }, timeoutMs)
        const onMessage = (): void => {
          clearTimeout(timer)
          this.emitter.off('message', onMessage)
          resolve()
        }
        this.emitter.on('message', onMessage)
      })
    }
  }

  close(): Promise<number> {
    this.socket.close()
    return this.closePromise
  }
}
