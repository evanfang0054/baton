import type { SupervisorMessage } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSupervisorMessages, getSupervisorStatus, listNotices, readNotice } from '../../lib/api'
import { CommandProvider } from '../../lib/command-context'
import { useAppStore } from '../../stores/app'
import { SupervisorPanel } from './SupervisorPanel'

vi.mock('../../lib/api', () => ({
  getSupervisorStatus: vi.fn(),
  getSupervisorMessages: vi.fn(),
  listNotices: vi.fn().mockResolvedValue({ notices: [] }),
  readNotice: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@heroui/react/toast', () => ({ toast: { success: vi.fn(), danger: vi.fn() } }))

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
  vi.mocked(readNotice).mockResolvedValue(undefined)
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

  it('renders a digest message with inline actions and no report panel', async () => {
    vi.mocked(getSupervisorMessages).mockResolvedValue({
      threadId: 'th1',
      messages: [
        {
          id: 'm-digest',
          threadId: 'th1',
          role: 'assistant',
          content: '本轮汇报 · 11/24 10:00\n共 2 个任务：待处理 1，待验收 1，进行中 0',
          toolCalls: [],
          decision: null,
          meta: {
            contextNodeIds: [],
            targetNodeId: null,
            digest: {
              noticeId: 'n1',
              trigger: 'schedule',
              generatedAt: 1,
              items: [
                {
                  taskId: 't1',
                  title: '登录页修复',
                  kind: 'review',
                  reason: '验收通过后等你确认',
                  waitingSince: null,
                  proposalId: null,
                  action: { type: 'open_review' },
                },
              ],
            },
          },
          status: 'ok',
          error: null,
          createdAt: 2,
        },
      ],
    })
    renderPanel()

    expect(await screen.findByText(/本轮汇报 · 11\/24 10:00/)).toBeVisible()
    expect(screen.getByText('登录页修复')).toBeVisible()
    expect(screen.queryByRole('heading', { name: '本轮汇报' })).toBeNull()
    expect(screen.queryByRole('button', { name: '生成汇报' })).toBeNull()
    expect(screen.queryByRole('button', { name: '历史' })).toBeNull()
    expect(screen.queryByText(/待我处理/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '去验收' }))
    expect(useAppStore.getState().activeTaskId).toBe('t1')
  })

  it('marks the latest digest notice read while the panel is open', async () => {
    vi.mocked(listNotices).mockResolvedValue({
      notices: [
        {
          id: 'n1',
          workspaceId: 'w1',
          ts: 1,
          kind: 'digest',
          payload: {},
          readAt: null,
        },
      ],
    })
    renderPanel()

    await waitFor(() => expect(readNotice).toHaveBeenCalledWith('n1'))
  })

  it('keeps the apply action when the decision fails', async () => {
    vi.mocked(getSupervisorMessages).mockResolvedValue({
      threadId: 'th1',
      messages: [
        {
          id: 'm-digest',
          threadId: 'th1',
          role: 'assistant',
          content: '本轮汇报 · 11/24 10:00',
          toolCalls: [],
          decision: null,
          meta: {
            contextNodeIds: [],
            targetNodeId: null,
            digest: {
              noticeId: 'n1',
              trigger: 'schedule',
              generatedAt: 1,
              items: [
                {
                  taskId: 't1',
                  title: '登录页修复',
                  kind: 'failed',
                  reason: '运行失败，建议重试',
                  waitingSince: null,
                  proposalId: 'act-1',
                  action: { type: 'apply_proposal', proposalId: 'act-1' },
                },
              ],
            },
          },
          status: 'ok',
          error: null,
          createdAt: 2,
        },
      ],
    })
    const send = vi.fn().mockRejectedValue(new Error('decision failed'))
    renderPanel(send)

    await userEvent.click(await screen.findByRole('button', { name: '应用建议' }))
    await waitFor(() => expect(send).toHaveBeenCalled())
    // 失败时不能把动作改成“已应用”，否则用户会以为已经生效。
    expect(screen.getByRole('button', { name: '应用建议' })).toBeVisible()
    expect(screen.queryByText('已应用')).toBeNull()
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
          meta: { contextNodeIds: [], targetNodeId: null, digest: null },
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
