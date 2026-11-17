import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App smoke', () => {
  it('renders the HeroUI baseline', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'baton' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建任务' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('输入任务标题')).toBeInTheDocument()
  })
})
