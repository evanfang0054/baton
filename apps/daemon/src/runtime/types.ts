import type { AppError, Policy, TaskStatus } from '@baton/protocol'
import type { BroadcastEvent } from '../db/event-store.js'

export interface StartSessionInput {
  taskId: string
  sessionId: string
  workspacePath: string
  policy: Policy
}

export interface RuntimeHooks {
  broadcast(event: BroadcastEvent): void
  startSession(input: StartSessionInput): void | Promise<void>
  interruptSession(taskId: string): void | Promise<void>
  resolveApproval(
    approvalId: string,
    decision: 'allow' | 'deny',
    note?: string,
  ): void | Promise<void>
  runVerify(taskId: string): void | Promise<void>
  kick(): void
  track(action: () => void | Promise<void>): void
}

export type TransitionOutcome =
  | {
      ok: true
      taskId: string
      status: TaskStatus
      previousStatus: TaskStatus
      retryCount: number
      events: BroadcastEvent[]
    }
  | { ok: false; error: AppError }

export function isActiveStatus(status: TaskStatus): boolean {
  return status === 'running' || status === 'waiting_input' || status === 'verifying'
}
