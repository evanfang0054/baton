import { z } from 'zod'
import { EventSchemas } from './agui.js'
import { DiffStat, Id, Timestamp } from './common.js'
import { ContextInjectionSource } from './context.js'
import { ApprovalRequest } from './entities/approval.js'
import { Notice } from './entities/notice.js'
import { PreliminaryVerdict } from './entities/review.js'
import { Attention, SessionOutcome, TaskStatus, WaitingReason } from './enums.js'
import { AppError } from './errors.js'
import { SupervisorMessage } from './supervisor.js'

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
  payload: z.object({
    commandId: Id,
    ok: z.literal(true),
    /** 命令结果的最小附加数据；形状由命令约定（taskId/cursor 等）。 */
    data: z.unknown().optional(),
  }),
})
export type AckEvent = z.infer<typeof AckEvent>

export const ErrorEvent = EventBase.extend({
  type: z.literal('error'),
  seq: z.number().int().nonnegative().optional(),
  payload: AppError.extend({ commandId: Id.optional() }),
})
export type ErrorEvent = z.infer<typeof ErrorEvent>

export const SESSION_OUTCOME_EVENT = 'session.outcome'
export const USER_MESSAGE_EVENT = 'user.message'
export const SESSION_USAGE_EVENT = 'baton.session.usage'

export const SessionUsageValue = z
  .object({
    costUsd: z.number().finite().nonnegative().optional(),
    turns: z.number().int().nonnegative().optional(),
  })
  .refine((value) => value.costUsd !== undefined || value.turns !== undefined, {
    message: 'usage must contain costUsd or turns',
  })
export type SessionUsageValue = z.infer<typeof SessionUsageValue>

export const SessionOutcomeValue = z.object({
  outcome: SessionOutcome.exclude(['unreported']),
  reason: z.string().min(1).optional(),
})
export type SessionOutcomeValue = z.infer<typeof SessionOutcomeValue>

export const TaskStatusCause = z.object({
  waitingReason: WaitingReason.optional(),
  outcome: SessionOutcome.optional(),
  sessionId: Id.optional(),
  approvalId: Id.optional(),
  reviewId: Id.optional(),
  reason: z.string().min(1).optional(),
})
export type TaskStatusCause = z.infer<typeof TaskStatusCause>

export const TaskStatusEvent = ReplayableBase.extend({
  type: z.literal('task.status'),
  payload: z.object({
    taskId: Id,
    status: TaskStatus,
    previousStatus: TaskStatus,
    retryCount: z.number().int().nonnegative(),
    updatedAt: Timestamp,
    cause: TaskStatusCause.optional(),
    attention: Attention.optional(),
  }),
})
export type TaskStatusEvent = z.infer<typeof TaskStatusEvent>

export const SessionEvent = ReplayableBase.extend({
  type: z.literal('session.event'),
  payload: z.object({
    sessionId: Id,
    /** 会话内序号；旧 ws_event 行可能没有，读取端需容忍。 */
    seq: z.number().int().nonnegative().optional(),
    event: EventSchemas,
  }),
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

/** 适配器与 daemon 共享的自定义事件契约：agent-fake 发出，session runner 解析。 */
export const APPROVAL_REQUEST_EVENT = 'approval.request'
export const ApprovalRequestValue = z.object({
  requestId: z.string().min(1),
  request: ApprovalRequest,
})
export type ApprovalRequestValue = z.infer<typeof ApprovalRequestValue>

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

export const SupervisorDeltaEvent = EventBase.extend({
  type: z.literal('supervisor.delta'),
  payload: z.object({
    threadId: Id,
    messageId: Id,
    delta: z.string(),
  }),
})
export type SupervisorDeltaEvent = z.infer<typeof SupervisorDeltaEvent>

export const SupervisorToolEvent = EventBase.extend({
  type: z.literal('supervisor.tool'),
  payload: z.object({
    threadId: Id,
    messageId: Id,
    toolCallId: z.string().min(1),
    name: z.string().min(1),
    phase: z.enum(['start', 'end']),
    ok: z.boolean().optional(),
    summary: z.string().optional(),
  }),
})
export type SupervisorToolEvent = z.infer<typeof SupervisorToolEvent>

export const SupervisorMessageEvent = EventBase.extend({
  type: z.literal('supervisor.message'),
  payload: SupervisorMessage,
})
export type SupervisorMessageEvent = z.infer<typeof SupervisorMessageEvent>

export const NoticeEvent = ReplayableBase.extend({
  type: z.literal('notice'),
  payload: Notice,
})
export type NoticeEvent = z.infer<typeof NoticeEvent>

export const ReviewPreliminaryEvent = ReplayableBase.extend({
  type: z.literal('review.preliminary'),
  payload: z.object({
    taskId: Id,
    reviewId: Id,
    verdict: PreliminaryVerdict,
    at: Timestamp,
  }),
})
export type ReviewPreliminaryEvent = z.infer<typeof ReviewPreliminaryEvent>

export const ContextInjectedEvent = ReplayableBase.extend({
  type: z.literal('context.injected'),
  payload: z.object({
    taskId: Id,
    seq: z.number().int().positive(),
    at: Timestamp,
    source: ContextInjectionSource,
    nodeIds: z.array(Id).min(1),
    chars: z.number().int().nonnegative(),
  }),
})
export type ContextInjectedEvent = z.infer<typeof ContextInjectedEvent>

export const ServerMessage = z.discriminatedUnion('type', [
  AckEvent,
  ErrorEvent,
  TaskStatusEvent,
  SessionEvent,
  ApprovalRequestEvent,
  VerifyResultEvent,
  SupervisorDeltaEvent,
  SupervisorToolEvent,
  SupervisorMessageEvent,
  NoticeEvent,
  ReviewPreliminaryEvent,
  ContextInjectedEvent,
])
export type ServerMessage = z.infer<typeof ServerMessage>
