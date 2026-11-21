import type { SupervisorMessage as SupervisorMessageRecord } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SupervisorMessage } from './SupervisorMessage'

const message: SupervisorMessageRecord = {
  id: 'm1',
  threadId: 'th1',
  role: 'assistant',
  content: '已批量建好。',
  toolCalls: [
    {
      id: 'tc1',
      name: 'create_tasks',
      args: {},
      ok: true,
      result: {
        created: [
          {
            taskId: 't1',
            title: '需求 A',
            target: { id: 'a1', title: 'Agent 1', engine: 'claude-sdk' },
            contextCount: 0,
            status: 'todo',
          },
          {
            taskId: 't2',
            title: '需求 B',
            target: { id: 'a1', title: 'Agent 1', engine: 'claude-sdk' },
            contextCount: 0,
            status: 'todo',
          },
        ],
        failed: [
          {
            nodeId: 'text-3',
            stage: 'create',
            error: { code: 'invalid_payload', message: 'bad node' },
          },
        ],
      },
    },
  ],
  decision: null,
  meta: null,
  status: 'ok',
  error: null,
  createdAt: 2,
}

describe('SupervisorMessage', () => {
  it('renders every created task card and each batch failure', () => {
    render(<SupervisorMessage message={message} />)
    expect(screen.getByText('需求 A')).toBeVisible()
    expect(screen.getByText('需求 B')).toBeVisible()
    expect(screen.getByText(/text-3/)).toBeVisible()
    expect(screen.getByText(/bad node/)).toBeVisible()
  })

  it('renders a pending question summary from get_task', () => {
    render(
      <SupervisorMessage
        message={{
          ...message,
          id: 'm-pending',
          content: '任务 t1 在等你选方案：A 或 B。',
          toolCalls: [
            {
              id: 'tc-get',
              name: 'get_task',
              args: { taskId: 't1' },
              ok: true,
              result: {
                task: { id: 't1', title: '整理需求', status: 'waiting_input' },
                pending: {
                  kind: 'question',
                  question: {
                    questions: [
                      { question: '用哪个方案？', options: [{ label: 'A' }, { label: 'B' }] },
                    ],
                  },
                },
              },
            },
          ],
        }}
      />,
    )
    expect(screen.getByText(/在等你选方案/)).toBeVisible()
    expect(screen.getByText('get_task')).toBeVisible()
  })

  it('renders a handoff task card with its source and worktree warning', () => {
    render(
      <SupervisorMessage
        message={{
          ...message,
          id: 'm-handoff',
          content: '已把结果交给新任务。',
          toolCalls: [
            {
              id: 'tc-handoff',
              name: 'handoff_task',
              args: { fromTaskId: 'task-1' },
              ok: true,
              result: {
                task: {
                  taskId: 'task-2',
                  title: '跟进：登录页改造',
                  target: { id: 'a1', title: 'Agent 1', engine: 'claude-sdk' },
                  contextCount: 1,
                  status: 'todo',
                },
                handoff: {
                  nodeId: 'handoff-1',
                  fromTaskId: 'task-1',
                  fromTitle: '登录页改造',
                  fromStatus: 'review',
                  worktree: true,
                  warnings: ['源任务在隔离 worktree，变更文件在主工作区不可读。'],
                },
              },
            },
          ],
        }}
      />,
    )
    expect(screen.getByText('跟进：登录页改造')).toBeVisible()
    expect(screen.getByText(/交接自《登录页改造》/)).toBeVisible()
    expect(screen.getByText(/变更文件在主工作区不可读/)).toBeVisible()
  })
})
