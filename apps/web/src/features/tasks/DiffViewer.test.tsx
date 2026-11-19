import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getReviewDiff } from '../../lib/api'
import { DiffViewer } from './DiffViewer'

vi.mock('../../lib/api', () => ({ getReviewDiff: vi.fn() }))

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <DiffViewer reviewId="r1" onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.mocked(getReviewDiff).mockReset())

describe('DiffViewer', () => {
  it('renders file list, patch, truncation and binary marker', async () => {
    vi.mocked(getReviewDiff).mockResolvedValue({
      v: 1,
      capturedAt: 1,
      baseRef: 'HEAD',
      truncated: true,
      files: [
        {
          path: 'a.txt',
          status: 'modified',
          insertions: 1,
          deletions: 1,
          patch: '@@ -1 +1 @@\n-old\n+new',
        },
        {
          path: 'b.bin',
          status: 'binary',
          insertions: 0,
          deletions: 0,
          patch: '',
        },
      ],
    })
    wrap()

    expect(await screen.findByText('a.txt')).toBeInTheDocument()
    expect(screen.getByText('+new')).toBeInTheDocument()
    expect(screen.getByText('-old')).toBeInTheDocument()
    expect(screen.getByText(/已截断/)).toBeInTheDocument()
    expect(screen.getByText('b.bin')).toBeInTheDocument()
    expect(screen.getByText(/二进制文件/)).toBeInTheDocument()
  })

  it('renders rename old and new paths', async () => {
    vi.mocked(getReviewDiff).mockResolvedValue({
      v: 1,
      capturedAt: 1,
      baseRef: 'HEAD',
      truncated: false,
      files: [
        {
          path: 'b.txt',
          oldPath: 'a.txt',
          status: 'renamed',
          insertions: 0,
          deletions: 0,
          patch: 'rename from a.txt\nrename to b.txt',
        },
      ],
    })
    wrap()
    expect(await screen.findByText('a.txt → b.txt')).toBeInTheDocument()
    expect(screen.getByText('重命名')).toBeInTheDocument()
  })

  it('shows the unavailable state for old reviews', async () => {
    vi.mocked(getReviewDiff).mockRejectedValue({ code: 'diff_unavailable' })
    wrap()
    expect(await screen.findByText(/没有 diff 快照/)).toBeInTheDocument()
  })
})
