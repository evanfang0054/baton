import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { formatElapsed, WaitingTime } from './WaitingTime'

describe('WaitingTime', () => {
  it('formats minutes and hours', () => {
    expect(formatElapsed(0, 12 * 60_000)).toBe('已等 12 分钟')
    expect(formatElapsed(0, 72 * 60_000)).toBe('已等 1 小时 12 分')
  })

  it('renders the elapsed text', () => {
    render(<WaitingTime since={Date.now() - 5 * 60_000} />)
    expect(screen.getByText('已等 5 分钟')).toBeInTheDocument()
  })
})
