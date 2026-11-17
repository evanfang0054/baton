import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { ReplyComposer } from './ReplyComposer'

describe('ReplyComposer', () => {
  it('disables empty sends and sends trimmed text', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const onDone = vi.fn()
    render(
      <CommandProvider send={send}>
        <ReplyComposer taskId="t1" onDone={onDone} />
      </CommandProvider>,
    )

    const button = screen.getByRole('button', { name: '发送' })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByLabelText('回复内容'), { target: { value: '  继续  ' } })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'session.reply',
        payload: { taskId: 't1', text: '继续' },
      }),
    )
    expect(onDone).toHaveBeenCalled()
  })
})
