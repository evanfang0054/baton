import type { SessionEventsResponse } from '@baton/protocol'
import { toast } from '@heroui/react/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../../lib/query'
import { useAppStore } from '../../stores/app'
import { RealtimeProvider } from './RealtimeProvider'

vi.mock('@heroui/react/toast', () => ({ toast: { danger: vi.fn() } }))

class FakeSocket {
  static readonly OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 0
  private listeners = new Map<string, Array<(event: { data?: unknown; code?: number }) => void>>()

  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event: { data?: unknown; code?: number }) => void) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  send() {}

  close() {
    this.readyState = 3
  }

  open() {
    this.readyState = 1
    this.emit('open', {})
  }

  message(payload: unknown) {
    this.emit('message', { data: JSON.stringify(payload) })
  }

  private emit(type: string, event: { data?: unknown; code?: number }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const initialEvents: SessionEventsResponse = {
  sessionId: 's1',
  events: [],
  nextSeq: 0,
  hasMore: false,
}

function renderProvider(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <RealtimeProvider workspaceId="w1">
        <div />
      </RealtimeProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  useAppStore.setState({ activeTaskId: null, activeWorkspaceId: 'w1' })
  vi.mocked(toast.danger).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RealtimeProvider', () => {
  it('appends session events to the cache and dedupes by seq', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(queryKeys.sessionEvents('s1'), initialEvents)
    renderProvider(client)
    const socket = FakeSocket.instances[0]!
    socket.open()

    socket.message({
      v: 1,
      ts: 10,
      seq: 5,
      type: 'session.event',
      payload: {
        sessionId: 's1',
        seq: 1,
        event: { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' },
      },
    })
    await waitFor(() =>
      expect(
        client.getQueryData<SessionEventsResponse>(queryKeys.sessionEvents('s1'))?.events,
      ).toHaveLength(1),
    )

    socket.message({
      v: 1,
      ts: 11,
      seq: 6,
      type: 'session.event',
      payload: {
        sessionId: 's1',
        seq: 1,
        event: { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' },
      },
    })
    expect(
      client.getQueryData<SessionEventsResponse>(queryKeys.sessionEvents('s1'))?.events,
    ).toHaveLength(1)

    socket.message({
      v: 1,
      ts: 12,
      seq: 7,
      type: 'session.event',
      payload: {
        sessionId: 's1',
        seq: 2,
        event: { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' },
      },
    })
    await waitFor(() =>
      expect(
        client.getQueryData<SessionEventsResponse>(queryKeys.sessionEvents('s1'))?.events,
      ).toHaveLength(2),
    )
  })

  it('coalesces invalidations and surfaces broadcast errors as toasts', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderProvider(client)
    const socket = FakeSocket.instances[0]!
    socket.open()

    socket.message({
      v: 1,
      ts: 20,
      seq: 8,
      type: 'task.status',
      payload: {
        taskId: 't1',
        status: 'running',
        previousStatus: 'queued',
        retryCount: 0,
        updatedAt: 20,
      },
    })
    socket.message({
      v: 1,
      ts: 21,
      seq: 9,
      type: 'verify.result',
      payload: {
        taskId: 't1',
        reviewId: 'r1',
        exitCode: 0,
        output: 'ok',
        diffStat: { filesChanged: 1, insertions: 1, deletions: 0 },
        durationMs: 5,
      },
    })

    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(invalidate).toHaveBeenCalledTimes(1)

    socket.message({
      v: 1,
      ts: 22,
      type: 'error',
      payload: { code: 'internal', message: '管道炸了' },
    })
    expect(toast.danger).toHaveBeenCalledWith('管道炸了')
  })
})
