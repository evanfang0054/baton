import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installMatchMedia } from '../test/match-media'
import { useViewport } from './use-viewport'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useViewport', () => {
  it('maps widths to mobile/compact/desktop and reacts to changes', () => {
    const media = installMatchMedia(390)
    const { result } = renderHook(() => useViewport())

    expect(result.current).toBe('mobile')

    media.resize(800)
    expect(result.current).toBe('compact')

    media.resize(1280)
    expect(result.current).toBe('desktop')
  })

  it('falls back to desktop without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useViewport())
    expect(result.current).toBe('desktop')
  })
})
