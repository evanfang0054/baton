import WebSocket from 'ws'
import { describe, expect, it } from 'vitest'
import { MAX_BUFFERED, sendSafely } from '../src/ws/send.js'

describe('sendSafely', () => {
  it('closes a slow client instead of buffering more frames', () => {
    const closed: Array<[number, string]> = []
    const socket = {
      readyState: WebSocket.OPEN,
      bufferedAmount: MAX_BUFFERED + 1,
      close: (code: number, reason: string) => closed.push([code, reason]),
    } as unknown as WebSocket

    expect(sendSafely(socket, '{}')).toBe(false)
    expect(closed).toEqual([[1013, 'slow client']])
  })

  it('terminates the socket when send throws', () => {
    let terminated = false
    const socket = {
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      send: () => {
        throw new Error('boom')
      },
      terminate: () => {
        terminated = true
      },
    } as unknown as WebSocket

    expect(sendSafely(socket, '{}')).toBe(false)
    expect(terminated).toBe(true)
  })
})
