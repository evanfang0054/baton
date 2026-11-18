import type { Approval } from '@baton/protocol'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { QuestionCard } from './QuestionCard'

const approval: Approval = {
  id: 'q1',
  sessionId: 's1',
  request: {
    toolName: 'AskUserQuestion',
    risk: 'high',
    input: {
      questions: [
        {
          question: '用哪种方案？',
          header: '方案',
          multiSelect: false,
          options: [
            { label: '方案 A', description: '改动小' },
            { label: '方案 B', description: '重构彻底' },
          ],
        },
        {
          question: '需要哪些测试？',
          header: '测试',
          multiSelect: true,
          options: [
            { label: '单元测试', description: 'vitest' },
            { label: 'E2E', description: 'playwright' },
          ],
        },
      ],
    },
  },
  decision: null,
  decidedBy: null,
  decidedAt: null,
  response: null,
}

describe('QuestionCard', () => {
  it('submits answers and optional response', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const onDone = vi.fn()
    render(
      <CommandProvider send={send}>
        <QuestionCard approval={approval} onDone={onDone} />
      </CommandProvider>,
    )

    const submit = screen.getByRole('button', { name: '提交选择' })
    expect(submit).toBeDisabled()

    await userEvent.click(screen.getByText('方案 A'))
    await userEvent.click(screen.getByText('单元测试'))
    await userEvent.click(screen.getByText('E2E'))
    await userEvent.type(screen.getByLabelText('补充说明'), '先跑最小范围')
    await userEvent.click(submit)

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'approval.decide',
        payload: {
          approvalId: 'q1',
          decision: 'allow',
          answers: {
            '用哪种方案？': '方案 A',
            '需要哪些测试？': '单元测试,E2E',
          },
          response: '先跑最小范围',
        },
      }),
    )
    expect(onDone).toHaveBeenCalled()
  })

  it('denies without answers', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    render(
      <CommandProvider send={send}>
        <QuestionCard approval={approval} onDone={vi.fn()} />
      </CommandProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '拒绝' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'approval.decide',
        payload: { approvalId: 'q1', decision: 'deny' },
      }),
    )
  })

  it('falls back to a deny card when input is malformed', () => {
    render(
      <CommandProvider send={vi.fn()}>
        <QuestionCard
          approval={{ ...approval, request: { ...approval.request, input: {} } }}
          onDone={vi.fn()}
        />
      </CommandProvider>,
    )
    expect(screen.getByText('无法解析 Agent 的提问')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '提交选择' })).not.toBeInTheDocument()
  })
})
