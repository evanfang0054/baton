import type { Approval } from '@baton/protocol'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { ApprovalCard } from './ApprovalCard'

const approval: Approval = {
  id: 'a1',
  sessionId: 's1',
  request: {
    toolName: 'Bash',
    input: { command: 'pnpm test' },
    risk: 'medium',
    reason: '需要运行测试',
  },
  decision: null,
  decidedBy: null,
  decidedAt: null,
  response: null,
}

describe('ApprovalCard', () => {
  it('shows the request and sends allow', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const onDone = vi.fn()
    render(
      <CommandProvider send={send}>
        <ApprovalCard approval={approval} onDone={onDone} />
      </CommandProvider>,
    )

    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText(/pnpm test/)).toBeInTheDocument()
    expect(screen.getByText('中风险')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '允许' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'approval.decide',
        payload: { approvalId: 'a1', decision: 'allow' },
      }),
    )
    expect(onDone).toHaveBeenCalled()
  })

  it('shows command errors inline', async () => {
    const send = vi.fn().mockRejectedValue(new Error('审批已失效'))
    render(
      <CommandProvider send={send}>
        <ApprovalCard approval={approval} onDone={vi.fn()} />
      </CommandProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '拒绝' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('审批已失效')
  })
})
