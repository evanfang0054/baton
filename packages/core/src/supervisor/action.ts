import type { SupervisorActionStatus } from '@baton/protocol'

export const ACTION_TTL_MS = 24 * 60 * 60 * 1000
export const ACTION_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000
export const PROPOSED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const TRANSITIONS: Record<SupervisorActionStatus, SupervisorActionStatus[]> = {
  proposed: ['applied', 'ignored', 'failed', 'expired'],
  applied: [],
  ignored: [],
  failed: [],
  expired: [],
}

export function canTransitionAction(
  from: SupervisorActionStatus,
  to: SupervisorActionStatus,
): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isActionExpired(action: { expiresAt: number }, now: number): boolean {
  return action.expiresAt <= now
}
