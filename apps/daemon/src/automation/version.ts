import { createHash } from 'node:crypto'
import type { Policy } from '@baton/protocol'

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    )
  }
  return value
}

/** policy 版本只用于审计/汇报，不参与鉴权。 */
export function hashPolicy(policy: Policy): string {
  return createHash('sha256')
    .update(JSON.stringify(stable(policy)))
    .digest('hex')
    .slice(0, 12)
}
