import type { SupervisorMessage } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSupervisorMessages, getSupervisorStatus } from '../../lib/api'
import { CommandProvider } from '../../lib/command-context'
import { useAppStore } from '../../stores/app'
import { SupervisorPanel } from './SupervisorPanel'

vi.mock('../../lib/api', () => ({
  getSupervisorStatus: vi.fn(),
  getSupervisorMessages: vi.fn(),
  listNotices: vi.fn().mockResolvedValue({ notices: [] }),
}))

function renderPanel(send = vi.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <SupervisorPanel workspaceId="w1" contextNodes={[]} targetAgent={null} />
      </CommandProvider>
    </QueryClientProvider>,
  )
}

const assistantWithTaskCard: SupervisorMessage = {
  id: 'm2',
  threadId: 'th1',
  role: 'assistant',
  content: '已创建任务。',
  toolCalls: [
    {
      id: 'create_task',
      name: 'create_task',
      args: {},
      ok: true,
      result: {
        taskId: 't1',
        title: '整理需求',
        target: { id: 'a1', title: 'Agent 1', engine: 'claude-sdk' },
        contextCount: 2,
        status: 'todo',
      },
    },
  ],
  decision: null,
  meta: null,
  status: 'ok',
  error: null,
  createdAt: 2,
}

beforeEach(() => {
  useAppStore.setState({ activeWorkspaceId: 'w1', rightPanel: 'supervisor' })
  vi.mocked(getSupervisorStatus).mockResolvedValue({
    configured: true,
    mode: 'explicit',
    policyVersion: 'p1',
  })
  vi.mocked(getSupervisorMessages).mockResolvedValue({ threadId: 'th1', messages: [] })
})

describe('SupervisorPanel', () => {
  it('shows the unconfigured hint', async () => {
    vi.mocked(getSupervisorStatus).mockResolvedValue({
      configured: false,
      mode: 'explicit',
      policyVersion: 'p1',
      errorCode: 'supervisor_unavailable',
    })
    renderPanel()
    expect(await screen.findByText('总管未配置模型')).toBeVisible()
    expect(screen.getByRole('button', { name: '检查配置' })).toBeVisible()
  })

  it('renders a create_task card and opens the task without enqueuing it', async () => {
    vi.mocked(getSupervisorMessages).mockResolvedValue({
      threadId: 'th1',
      messages: [
        {
          id: 'm1',
          threadId: 'th1',
          role: 'user',
          content: '建个任务',
          toolCalls: [],
          decision: null,
          meta: null,
          status: 'ok',
          error: null,
          createdAt: 1,
        },
        assistantWithTaskCard,
      ],
    })
    renderPanel()

    expect(await screen.findByText('已创建任务。')).toBeVisible()
    expect(screen.getByText('整理需求')).toBeVisible()
    expect(screen.getByText('待办')).toBeVisible()
    expect(screen.getByText(/需要你点/)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: '打开任务' }))
    expect(useAppStore.getState().activeTaskId).toBe('t1')
    expect(useAppStore.getState().overlay).toEqual({ kind: 'stage', taskId: 't1' })
  })

  it('retries a failed turn with the previous user message', async () => {
    vi.mocked(getSupervisorMessages).mockResolvedValue({
      threadId: 'th1',
      messages: [
        {
          id: 'm1',
          threadId: 'th1',
          role: 'user',
          content: '建个任务',
          toolCalls: [],
          decision: null,
          meta: { contextNodeIds: [], targetNodeId: null },
          status: 'ok',
          error: null,
          createdAt: 1,
        },
        {
          id: 'm2',
          threadId: 'th1',
          role: 'assistant',
          content: '总管执行失败：模型不可用',
          toolCalls: [],
          decision: null,
          meta: null,
          status: 'error',
          error: { code: 'supervisor_unavailable', message: '模型不可用' },
          createdAt: 2,
        },
      ],
    })
    const send = vi.fn().mockResolvedValue(undefined)
    renderPanel(send)

    expect(await screen.findByText(/本轮失败 · supervisor_unavailable/)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(send).toHaveBeenCalledWith({
      type: 'supervisor.send',
      payload: {
        workspaceId: 'w1',
        requestId: expect.any(String),
        text: '建个任务',
        contextNodeIds: [],
      },
    })
  })
})
