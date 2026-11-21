import type { SessionEventsResponse, SupervisorMessagesResponse } from '@baton/protocol'
import { toast } from '@heroui/react/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../../lib/query'
import { useAppStore } from '../../stores/app'
import { useSupervisorStreamStore } from '../supervisor/stream-store'
import { RealtimeProvider } from './RealtimeProvider'

vi.mock('@heroui/react/toast', () => ({
  toast: { danger: vi.fn(), info: vi.fn() },
}))

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
  useSupervisorStreamStore.getState().reset()
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

  it('projects supervisor streams and appends the final message', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const initial: SupervisorMessagesResponse = { threadId: 'th1', messages: [] }
    client.setQueryData(queryKeys.supervisorMessages('w1'), initial)
    renderProvider(client)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const socket = FakeSocket.instances[0]!
    socket.open()

    socket.message({
      v: 1,
      ts: 30,
      type: 'supervisor.delta',
      payload: { threadId: 'th1', messageId: 'm1', delta: '正在建任务' },
    })
    socket.message({
      v: 1,
      ts: 31,
      type: 'supervisor.tool',
      payload: {
        threadId: 'th1',
        messageId: 'm1',
        toolCallId: 'tc1',
        name: 'create_task',
        phase: 'start',
      },
    })
    await waitFor(() => {
      const stream = useSupervisorStreamStore.getState()
      expect(stream.text).toBe('正在建任务')
      expect(stream.tools).toHaveLength(1)
      expect(stream.status).toBe('streaming')
    })

    socket.message({
      v: 1,
      ts: 32,
      type: 'supervisor.message',
      payload: {
        id: 'm1',
        threadId: 'th1',
        role: 'assistant',
        content: '已建任务',
        toolCalls: [],
        decision: {
          id: 'd1',
          threadId: 'th1',
          triggerId: 'r1',
          messageId: 'm1',
          kind: 'create_task',
          strength: 'explicit',
          mode: 'explicit',
          reason: 'test',
          taskId: null,
          toolCalls: [],
          createdAt: 32,
        },
        meta: null,
        status: 'ok',
        error: null,
        createdAt: 32,
      },
    })
    await waitFor(() =>
      expect(
        client.getQueryData<SupervisorMessagesResponse>(queryKeys.supervisorMessages('w1'))
          ?.messages,
      ).toHaveLength(1),
    )
    expect(useSupervisorStreamStore.getState().status).toBe('idle')
    expect(useSupervisorStreamStore.getState().text).toBe('')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tasks('w1') })
  })

  it('invalidates the canvas as soon as a supervisor tool writes to it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderProvider(client)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const socket = FakeSocket.instances[0]!
    socket.open()
    invalidate.mockClear()

    socket.message({
      v: 1,
      ts: 33,
      type: 'supervisor.tool',
      payload: {
        threadId: 'th1',
        messageId: 'm1',
        toolCallId: 'tc2',
        name: 'create_text',
        phase: 'end',
        ok: true,
      },
    })
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.canvas('w1') }),
    )

    invalidate.mockClear()
    socket.message({
      v: 1,
      ts: 34,
      type: 'supervisor.tool',
      payload: {
        threadId: 'th1',
        messageId: 'm1',
        toolCallId: 'tc-update',
        name: 'update_node',
        phase: 'end',
        ok: true,
      },
    })
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.canvas('w1') }),
    )

    invalidate.mockClear()
    socket.message({
      v: 1,
      ts: 35,
      type: 'supervisor.tool',
      payload: {
        threadId: 'th1',
        messageId: 'm1',
        toolCallId: 'tc3',
        name: 'create_text',
        phase: 'end',
        ok: false,
      },
    })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.canvas('w1') })
  })

  it('invalidates tasks and canvas after a successful batch create', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderProvider(client)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const socket = FakeSocket.instances[0]!
    socket.open()
    invalidate.mockClear()

    socket.message({
      v: 1,
      ts: 35,
      type: 'supervisor.tool',
      payload: {
        threadId: 'th1',
        messageId: 'm1',
        toolCallId: 'tc-batch',
        name: 'create_tasks',
        phase: 'end',
        ok: true,
      },
    })
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tasks('w1') })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.canvas('w1') })
    })
  })

  it('invalidates tasks and canvas after a successful handoff', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderProvider(client)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const socket = FakeSocket.instances[0]!
    socket.open()
    invalidate.mockClear()

    socket.message({
      v: 1,
      ts: 36,
      type: 'supervisor.tool',
      payload: {
        threadId: 'th1',
        messageId: 'm1',
        toolCallId: 'tc-handoff',
        name: 'handoff_task',
        phase: 'end',
        ok: true,
      },
    })
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tasks('w1') })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.canvas('w1') })
    })
  })

  it('refreshes the canvas when a finished turn created nodes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const initial: SupervisorMessagesResponse = { threadId: 'th1', messages: [] }
    client.setQueryData(queryKeys.supervisorMessages('w1'), initial)
    renderProvider(client)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const socket = FakeSocket.instances[0]!
    socket.open()
    invalidate.mockClear()

    socket.message({
      v: 1,
      ts: 35,
      type: 'supervisor.message',
      payload: {
        id: 'm2',
        threadId: 'th1',
        role: 'assistant',
        content: '已创建文本节点',
        toolCalls: [{ id: 'tc4', name: 'create_text', args: {}, ok: true, result: {} }],
        decision: null,
        meta: null,
        status: 'ok',
        error: null,
        createdAt: 35,
      },
    })
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.canvas('w1') }),
    )
  })

  it('replaces a notification when the polished version arrives', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const initial: SupervisorMessagesResponse = {
      threadId: 'th1',
      messages: [
        {
          id: 'n1',
          threadId: 'th1',
          role: 'assistant',
          content: '模板：任务进入待验收',
          toolCalls: [],
          decision: null,
          meta: null,
          status: 'ok',
          error: null,
          createdAt: 41,
        },
      ],
    }
    client.setQueryData(queryKeys.supervisorMessages('w1'), initial)
    renderProvider(client)
    const socket = FakeSocket.instances[0]!
    socket.open()

    socket.message({
      v: 1,
      ts: 42,
      type: 'supervisor.message',
      payload: {
        id: 'n1',
        threadId: 'th1',
        role: 'assistant',
        content: '润色后：任务已经进入待验收，我派了验收员。',
        toolCalls: [],
        decision: null,
        meta: null,
        status: 'ok',
        error: null,
        createdAt: 42,
      },
    })
    await waitFor(() => {
      const messages =
        client.getQueryData<SupervisorMessagesResponse>(queryKeys.supervisorMessages('w1'))
          ?.messages ?? []
      expect(messages).toHaveLength(1)
      expect(messages[0]?.content).toContain('润色后')
    })
  })

  it('keeps an active stream when an observer notification arrives', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const initial: SupervisorMessagesResponse = { threadId: 'th1', messages: [] }
    client.setQueryData(queryKeys.supervisorMessages('w1'), initial)
    renderProvider(client)
    const socket = FakeSocket.instances[0]!
    socket.open()

    socket.message({
      v: 1,
      ts: 40,
      type: 'supervisor.delta',
      payload: { threadId: 'th1', messageId: 'm1', delta: '正在处理' },
    })
    await waitFor(() => expect(useSupervisorStreamStore.getState().status).toBe('streaming'))

    socket.message({
      v: 1,
      ts: 41,
      type: 'supervisor.message',
      payload: {
        id: 'n1',
        threadId: 'th1',
        role: 'assistant',
        content: '任务进入待验收',
        toolCalls: [],
        decision: null,
        meta: null,
        status: 'ok',
        error: null,
        createdAt: 41,
      },
    })
    await waitFor(() =>
      expect(
        client.getQueryData<SupervisorMessagesResponse>(queryKeys.supervisorMessages('w1'))
          ?.messages,
      ).toHaveLength(1),
    )
    expect(useSupervisorStreamStore.getState().status).toBe('streaming')
  })

  it('coalesces invalidations and surfaces broadcast errors as toasts', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderProvider(client)
    const socket = FakeSocket.instances[0]!
    socket.open()
    invalidate.mockClear()

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
    // tasks + 当前任务详情/自动化记录各一次。
    expect(invalidate).toHaveBeenCalledTimes(2)

    socket.message({
      v: 1,
      ts: 22,
      type: 'error',
      payload: { code: 'internal', message: '管道炸了' },
    })
    expect(toast.danger).toHaveBeenCalledWith('管道炸了')
  })

  it('only toasts live digest notices for the active workspace', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderProvider(client)
    const socket = FakeSocket.instances[0]!
    socket.open()

    const notice = (ts: number, workspaceId: string) => ({
      v: 1,
      ts,
      seq: 10,
      type: 'notice',
      payload: {
        id: `n-${ts}`,
        workspaceId,
        ts,
        kind: 'digest',
        payload: {},
        readAt: null,
      },
    })
    // 回放的事件早于挂载时间；其他 workspace 的 notice 也不提示。
    socket.message(notice(1, 'w1'))
    socket.message(notice(Date.now() + 1000, 'w2'))
    expect(toast.info).not.toHaveBeenCalled()

    socket.message(notice(Date.now() + 1000, 'w1'))
    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1))
  })

  it('invalidates the target task on review.preliminary', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderProvider(client)
    const socket = FakeSocket.instances[0]!
    socket.open()

    socket.message({
      v: 1,
      ts: 30,
      seq: 11,
      type: 'review.preliminary',
      payload: { taskId: 't1', reviewId: 'r1', verdict: 'pass', at: 30 },
    })

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.task('t1') }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tasks('w1') })
  })

  it('invalidates canvas, tasks, and the target task after context.injected', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderProvider(client)
    const socket = FakeSocket.instances[0]!
    socket.open()
    invalidate.mockClear()

    socket.message({
      v: 1,
      ts: 40,
      seq: 12,
      type: 'context.injected',
      payload: {
        taskId: 't1',
        seq: 1,
        at: 40,
        source: 'user',
        nodeIds: ['n1'],
        chars: 5,
      },
    })

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.canvas('w1') })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tasks('w1') })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.task('t1') })
    })
  })
})
