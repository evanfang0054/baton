import { act } from '@testing-library/react'
import { vi } from 'vitest'

type Listener = (event: MediaQueryListEvent) => void

export function installMatchMedia(initialWidth: number) {
  let width = initialWidth
  const listeners = new Set<Listener>()

  const matches = (query: string) => {
    if (query.includes('max-width: 767px')) return width < 768
    if (query.includes('max-width: 1023px')) return width >= 768 && width < 1024
    if (query.includes('min-width: 1024px')) return width >= 1024
    return false
  }

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
      removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  )

  return {
    resize(nextWidth: number) {
      width = nextWidth
      act(() => {
        for (const listener of listeners) listener({} as MediaQueryListEvent)
      })
    },
  }
}
