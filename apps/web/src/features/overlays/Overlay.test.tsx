import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Overlay } from './Overlay'

describe('Overlay', () => {
  it('keeps focus inside the dialog when the parent re-renders', () => {
    const { rerender, getByRole } = render(
      <Overlay title="画板" onClose={() => {}}>
        <button type="button">编辑</button>
      </Overlay>,
    )
    const button = getByRole('button', { name: '编辑' })
    button.focus()
    rerender(
      <Overlay title="画板" onClose={() => {}}>
        <button type="button">编辑</button>
      </Overlay>,
    )
    expect(document.activeElement).toBe(button)
  })
})
