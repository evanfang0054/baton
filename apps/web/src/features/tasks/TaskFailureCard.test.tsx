import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TaskFailureCard } from './TaskFailureCard'

describe('TaskFailureCard', () => {
  it('shows stage, summary, relative paths and retryability', () => {
    render(
      <TaskFailureCard
        failure={{
          stage: 'verify',
          lastError: 'pnpm test failed',
          retryable: true,
          affectedPaths: ['src/login.ts'],
          summary: '自动校验未通过',
          createdAt: 1,
        }}
      />,
    )
    expect(screen.getByText('最近失败')).toBeVisible()
    expect(screen.getByText('自动校验')).toBeVisible()
    expect(screen.getByText('自动校验未通过')).toBeVisible()
    expect(screen.getByText('src/login.ts')).toBeVisible()
    expect(screen.getByText('可重试')).toBeVisible()
  })

  it('renders nothing without a failure', () => {
    const { container } = render(<TaskFailureCard failure={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
