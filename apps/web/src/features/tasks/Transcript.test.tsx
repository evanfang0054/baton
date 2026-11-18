import type { SessionEventRecord } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Transcript } from './Transcript'

const events: SessionEventRecord[] = [
  {
    seq: 1,
    ts: 1_700_000_000_000,
    type: 'TEXT_MESSAGE_CONTENT',
    payload: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: '你好' },
  },
  {
    seq: 2,
    ts: 1_700_000_001_000,
    type: 'TOOL_CALL_START',
    payload: { type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'Bash' },
  },
  {
    seq: 3,
    ts: 1_700_000_002_000,
    type: 'CUSTOM',
    payload: { type: 'CUSTOM', name: 'user.message', value: { text: '继续' } },
  },
]

describe('Transcript', () => {
  it('renders role labels and content', () => {
    render(<Transcript events={events} virtualize={false} />)
    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getByText('你好')).toBeInTheDocument()
    expect(screen.getByText('工具')).toBeInTheDocument()
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('你')).toBeInTheDocument()
    expect(screen.getByText('继续')).toBeInTheDocument()
  })

  it('shows a truncation hint for large events', () => {
    render(
      <Transcript
        events={[
          {
            seq: 1,
            ts: 1,
            type: 'TEXT_MESSAGE_CONTENT',
            payload: {
              type: 'TEXT_MESSAGE_CONTENT',
              messageId: 'm1',
              delta: 'x…[truncated]',
              _baton: { truncated: true, originalBytes: 70000 },
            },
          },
        ]}
        virtualize={false}
      />,
    )
    expect(screen.getByText('内容已截断，完整内容见原始事件')).toBeInTheDocument()
  })

  it('shows empty and loading states', () => {
    const { rerender } = render(<Transcript events={[]} virtualize={false} />)
    expect(screen.getByText('暂无会话记录')).toBeInTheDocument()
    rerender(<Transcript events={[]} loading virtualize={false} />)
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })
})
