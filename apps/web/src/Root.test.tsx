import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Root } from './Root'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ workspaces: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  )
})

describe('Root', () => {
  it('renders the app alongside the toast region', async () => {
    render(<Root />)
    expect(await screen.findByText('baton')).toBeInTheDocument()
    expect(screen.getByTestId('board-rail')).toBeInTheDocument()
    expect(screen.getByTestId('task-detail')).toBeInTheDocument()
  })
})
