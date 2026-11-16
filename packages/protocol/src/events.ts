import { z } from 'zod'
import { EventSchemas } from './agui.js'
import { DiffStat, Id, Timestamp } from './common.js'
import { ApprovalRequest } from './entities/approval.js'
import { TaskStatus } from './enums.js'

const EventBase = z.object({
  v: z.literal(1),
  ts: Timestamp,
})

const ReplayableBase = EventBase.extend({
  seq: z.number().int().nonnegative(),
})

export const AckEvent = EventBase.extend({
  type: z.literal('ack'),
  seq: z.number().int().nonnegative().optional(),
  payload: z.object({ commandId: Id, ok: z.literal(true) }),
})
export type AckEvent = z.infer<typeof AckEvent>

export const ErrorEvent = EventBase.extend({
  type: z.literal('error'),
  seq: z.number().int().nonnegative().optional(),
  payload: z.object({
    commandId: Id.optional(),
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
})
export type ErrorEvent = z.infer<typeof ErrorEvent>

export const TaskStatusEvent = ReplayableBase.extend({
  type: z.literal('task.status'),
  payload: z.object({
    taskId: Id,
    status: TaskStatus,
    previousStatus: TaskStatus,
    retryCount: z.number().int().nonnegative(),
    updatedAt: Timestamp,
  }),
})
export type TaskStatusEvent = z.infer<typeof TaskStatusEvent>

export const SessionEvent = ReplayableBase.extend({
  type: z.literal('session.event'),
  payload: z.object({ sessionId: Id, event: EventSchemas }),
})
export type SessionEvent = z.infer<typeof SessionEvent>

export const ApprovalRequestEvent = ReplayableBase.extend({
  type: z.literal('approval.request'),
  payload: z.object({
    approvalId: Id,
    sessionId: Id,
    request: ApprovalRequest,
  }),
})
export type ApprovalRequestEvent = z.infer<typeof ApprovalRequestEvent>

export const VerifyResultEvent = ReplayableBase.extend({
  type: z.literal('verify.result'),
  payload: z.object({
    taskId: Id,
    reviewId: Id,
    exitCode: z.number().int(),
    output: z.string(),
    diffStat: DiffStat,
    durationMs: z.number().int().nonnegative(),
  }),
})
export type VerifyResultEvent = z.infer<typeof VerifyResultEvent>

export const ServerMessage = z.discriminatedUnion('type', [
  AckEvent,
  ErrorEvent,
  TaskStatusEvent,
  SessionEvent,
  ApprovalRequestEvent,
  VerifyResultEvent,
])
export type ServerMessage = z.infer<typeof ServerMessage>
