import type { Engine, EngineStatus } from '@baton/protocol'

export function preferredEngine(engines: EngineStatus[]): Engine | null {
  const claude = engines.find(
    (entry) => entry.engine === 'claude-sdk' && entry.status !== 'unavailable',
  )
  return claude?.engine ?? null
}
