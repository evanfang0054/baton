import { Toast } from '@heroui/react/toast'
import { render, screen } from '@testing-library/react'
import { Children, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { Root } from './Root'

describe('Root', () => {
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

  it('renders the app alongside the toast region', async () => {
    render(<Root />)
    expect(await screen.findByText('baton')).toBeInTheDocument()
    expect(await screen.findByLabelText('交付列表')).toBeInTheDocument()
    expect(screen.getByTestId('right-panel')).toBeInTheDocument()

    const tree = Root() as unknown as ReactElement<{
      children: ReactElement<{ children: ReactNode }>
    }>
    const providers = Children.toArray(tree.props.children.props.children) as ReactElement[]
    expect(providers.map((element) => element.type)).toEqual([App, Toast.Provider])
  })
})
