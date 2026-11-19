import { useSyncExternalStore } from 'react'

export type Viewport = 'mobile' | 'compact' | 'desktop'

const MOBILE_QUERY = '(max-width: 767px)'
const COMPACT_QUERY = '(min-width: 768px) and (max-width: 1023px)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mobile = window.matchMedia(MOBILE_QUERY)
  const compact = window.matchMedia(COMPACT_QUERY)
  mobile.addEventListener('change', onChange)
  compact.addEventListener('change', onChange)
  return () => {
    mobile.removeEventListener('change', onChange)
    compact.removeEventListener('change', onChange)
  }
}

function getSnapshot(): Viewport {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop'
  if (window.matchMedia(MOBILE_QUERY).matches) return 'mobile'
  if (window.matchMedia(COMPACT_QUERY).matches) return 'compact'
  return 'desktop'
}

export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'desktop')
}
