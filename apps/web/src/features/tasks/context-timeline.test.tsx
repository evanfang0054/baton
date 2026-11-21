import type { ContextSnapshot } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ContextTimeline } from './ContextTimeline'

const snapshot: ContextSnapshot = {
  included: [{ id: 'old', type: 'text', title: '初始需求', depth: 0, chars: 4 }],
  dropped: [],
  truncated: false,
  redactedPaths: [],
  relations: [],
  relationsTruncated: false,
  injections: [
    {
      seq: 1,
      at: 1_700_000_000_000,
      source: 'user',
      note: '补充报错',
      requestId: null,
      nodeIds: ['n1'],
      included: [{ id: 'n1', type: 'text', title: '报错日志', depth: 0, chars: 10 }],
      dropped: [],
      truncated: false,
      relations: [],
      relationsTruncated: false,
      chars: 12,
    },
  ],
}

describe('ContextTimeline', () => {
  it('shows initial snapshot and injection revisions', () => {
    render(<ContextTimeline snapshot={snapshot} targetNodeId="a1" />)
    expect(screen.getByText('初始需求')).toBeInTheDocument()
    expect(screen.getByText('注入 #1')).toBeInTheDocument()
    expect(screen.getByText('补充报错')).toBeInTheDocument()
    expect(screen.getByText('报错日志')).toBeInTheDocument()
  })

  it('selects a node from an injection chip', async () => {
    const onSelectNode = vi.fn()
    render(<ContextTimeline snapshot={snapshot} targetNodeId="a1" onSelectNode={onSelectNode} />)
    await userEvent.click(screen.getByRole('button', { name: '报错日志' }))
    expect(onSelectNode).toHaveBeenCalledWith('n1')
  })

  it('marks deleted nodes and disables their chips', () => {
    render(
      <ContextTimeline
        snapshot={snapshot}
        targetNodeId="a1"
        knownNodeIds={new Set(['other'])}
        onSelectNode={vi.fn()}
      />,
    )
    const chip = screen.getByRole('button', { name: '报错日志（已删除）' })
    expect(chip).toBeDisabled()
  })
})
