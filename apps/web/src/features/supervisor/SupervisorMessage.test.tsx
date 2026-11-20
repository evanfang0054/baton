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
})
