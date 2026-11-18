import type { ContextSnapshot } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContextSnapshotCard } from './ContextSnapshotCard'

const snapshot: ContextSnapshot = {
  included: [
    { id: 'n1', type: 'text', title: '需求 A', depth: 0, chars: 12 },
    { id: 'n2', type: 'file', title: 'spec.md', depth: 1, chars: 40 },
  ],
  dropped: [{ id: 'n3', reason: 'sensitive', title: '.env' }],
  truncated: true,
  redactedPaths: ['.env'],
  relations: [
    {
      from: 'n1',
      to: 'n2',
      type: 'context',
      fromTitle: '需求 A',
      toTitle: 'spec.md',
      includedFrom: true,
      includedTo: true,
    },
  ],
  relationsTruncated: true,
}

describe('ContextSnapshotCard', () => {
  it('shows included, dropped and relations', () => {
    render(<ContextSnapshotCard snapshot={snapshot} />)
    expect(screen.getByText('上下文快照')).toBeInTheDocument()
    expect(screen.getByText('需求 A')).toBeInTheDocument()
    expect(screen.getByText('spec.md')).toBeInTheDocument()
    expect(screen.getByText('敏感文件已排除')).toBeInTheDocument()
    expect(screen.getByText('需求 A → spec.md')).toBeInTheDocument()
    expect(screen.getByText('关系已截断')).toBeInTheDocument()
  })

  it('handles old tasks without a snapshot', () => {
    render(<ContextSnapshotCard snapshot={null} />)
    expect(screen.getByText('该任务创建于上下文快照上线前，未记录')).toBeInTheDocument()
  })
})
