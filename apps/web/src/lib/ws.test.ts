import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWsClient, parseIncomingMessage } from './ws'

class FakeSocket {
  static readonly OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 0
  sent: string[] = []
  private listeners = new Map<string, Array<(event: { data?: unknown; code?: number }) => void>>()

  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event: { data?: unknown; code?: number }) => void) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }

  open() {
    this.readyState = 1
    this.emit('open', {})
  }

  message(payload: unknown) {
    this.emit('message', {
      data: typeof payload === 'string' ? payload : JSON.stringify(payload),
    })
  }

  serverClose(code: number) {
    this.readyState = 3
    this.emit('close', { code })
  }

  private emit(type: string, event: { data?: unknown; code?: number }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function resumePayload(socket: FakeSocket, index: number) {
  return JSON.parse(socket.sent[index]!) as { payload: { sinceSeq?: number } }
}

const taskStatus = {
  v: 1,
  ts: 1,
  seq: 7,
  type: 'task.status',
  payload: {
    taskId: 't1',
    status: 'running',
    previousStatus: 'queued',
    retryCount: 0,
    updatedAt: 1,
  },
}

const sessionEvent = {
  v: 1,
  ts: 3,
  seq: 8,
  type: 'session.event',
  payload: {
    sessionId: 's1',
    seq: 8,
    event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'hi' },
  },
}

describe('parseIncomingMessage', () => {
  it('accepts a valid session.event via the lightweight path', () => {
    const parsed = parseIncomingMessage(sessionEvent)
    expect(parsed?.type).toBe('session.event')
  })

  it('rejects a malformed session.event', () => {
    expect(
      parseIncomingMessage({
        ...sessionEvent,
        payload: { ...sessionEvent.payload, seq: 'bad' },
      }),
    ).toBeNull()
  })

  it('still validates control messages with the full schema', () => {
    expect(parseIncomingMessage({ v: 1, ts: 1, type: 'unknown', payload: {} })).toBeNull()
  })
})

beforeEach(() => {
  FakeSocket.instances = []
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('createWsClient', () => {
  it('validates incoming events and resumes from zero on first connect', () => {
    const onStatus = vi.fn()
    const onEvent = vi.fn()
    const client = createWsClient({ onStatus, onEvent })
    const socket = FakeSocket.instances[0]!

    expect(onStatus).toHaveBeenLastCalledWith('connecting')
    socket.open()
    expect(onStatus).toHaveBeenLastCalledWith('online')
    expect(socket.sent).toHaveLength(1)
    expect(resumePayload(socket, 0).payload.sinceSeq).toBe(0)

    socket.message(taskStatus)
    expect(onEvent).toHaveBeenCalledTimes(1)

    socket.message({ v: 1, ts: 2, type: 'unknown', payload: {} })
    socket.message('not-json')
    expect(onEvent).toHaveBeenCalledTimes(1)

    client.close()
  })

  it('resumes from the last seq after reconnect and pages until hasMore is false', () => {
    const onStatus = vi.fn()
    const client = createWsClient({ onStatus, onEvent: vi.fn() })
    const first = FakeSocket.instances[0]!
    first.open()
    first.message(taskStatus)

    first.serverClose(1006)
    expect(onStatus).toHaveBeenLastCalledWith('offline')
    vi.advanceTimersByTime(1000)

    expect(FakeSocket.instances).toHaveLength(2)
    const second = FakeSocket.instances[1]!
    second.open()
    expect(second.sent).toHaveLength(1)
    expect(resumePayload(second, 0).payload.sinceSeq).toBe(7)

    second.message({
      v: 1,
      ts: 3,
      type: 'ack',
      payload: { commandId: 'c1', ok: true, data: { cursor: 9, hasMore: true } },
    })
    expect(second.sent).toHaveLength(2)
    expect(resumePayload(second, 1).payload.sinceSeq).toBe(9)

    second.message({
      v: 1,
      ts: 4,
      type: 'ack',
      payload: { commandId: 'c2', ok: true, data: { cursor: 12, hasMore: false } },
    })
    expect(second.sent).toHaveLength(2)
    expect(client.lastSeq()).toBe(12)
    client.close()
  })

  it('stops retrying on fatal close codes', () => {
    const onStatus = vi.fn()
    const client = createWsClient({ onStatus, onEvent: vi.fn() })
    FakeSocket.instances[0]!.open()
    FakeSocket.instances[0]!.serverClose(4401)

    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
    expect(onStatus).toHaveBeenLastCalledWith('unauthorized')
    client.close()
  })

  it('resolves a command on ack and rejects on command error', async () => {
    const client = createWsClient({ onStatus: vi.fn(), onEvent: vi.fn() })
    const socket = FakeSocket.instances[0]!
    socket.open()

    const first = client.sendCommand({ type: 'task.enqueue', payload: { taskId: 't1' } })
    const sent = JSON.parse(socket.sent[1]!) as { id: string; type: string }
    expect(sent.type).toBe('task.enqueue')
    socket.message({
      v: 1,
      ts: 2,
      type: 'ack',
      payload: { commandId: sent.id, ok: true, data: { taskId: 't1' } },
    })
    await expect(first).resolves.toEqual({ taskId: 't1' })

    const second = client.sendCommand({ type: 'task.cancel', payload: { taskId: 't1' } })
    const sent2 = JSON.parse(socket.sent[2]!) as { id: string }
    socket.message({
      v: 1,
      ts: 3,
      type: 'error',
      payload: { commandId: sent2.id, code: 'task_not_found', message: 'task not found' },
    })
    await expect(second).rejects.toMatchObject({ code: 'task_not_found' })
    client.close()
  })

  it('times out commands and rejects when offline', async () => {
    const client = createWsClient({ onStatus: vi.fn(), onEvent: vi.fn() })
    const socket = FakeSocket.instances[0]!
    socket.open()

    const pending = client.sendCommand({ type: 'task.enqueue', payload: { taskId: 't1' } })
    vi.advanceTimersByTime(10_000)
    await expect(pending).rejects.toMatchObject({ code: 'ack_timeout' })

    const offline = client.sendCommand({ type: 'task.enqueue', payload: { taskId: 't1' } })
    socket.serverClose(1006)
    await expect(offline).rejects.toMatchObject({ code: 'ws_closed' })

    const never = client.sendCommand({ type: 'task.enqueue', payload: { taskId: 't1' } })
    await expect(never).rejects.toMatchObject({ code: 'ws_offline' })
    client.close()
  })
})
