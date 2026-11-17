import { z } from 'zod'
import { Id, Timestamp } from './common.js'
import { ApprovalDecision, Engine, WorkspaceMode } from './enums.js'

export const ResumeInput = z.object({
  sinceSeq: z.number().int().nonnegative().optional(),
})
export type ResumeInput = z.infer<typeof ResumeInput>

export const TaskCreateInput = z.object({
  workspaceId: Id,
  nodeId: Id,
  title: z.string().min(1),
  prompt: z.string().min(1),
  contextNodeIds: z.array(Id),
  engine: Engine,
  workspaceMode: WorkspaceMode.default('main'),
  verifyCommand: z.string().min(1).optional(),
})
export type TaskCreateInput = z.infer<typeof TaskCreateInput>

export const TaskEnqueueInput = z.object({ taskId: Id })
export type TaskEnqueueInput = z.infer<typeof TaskEnqueueInput>

export const TaskCancelInput = z.object({
  taskId: Id,
  reason: z.string().min(1).optional(),
})
export type TaskCancelInput = z.infer<typeof TaskCancelInput>

export const SessionReplyInput = z.object({
  taskId: Id,
  text: z.string().min(1).max(16_384),
})
export type SessionReplyInput = z.infer<typeof SessionReplyInput>

export const ApprovalDecideInput = z.object({
  approvalId: Id,
  decision: ApprovalDecision,
  note: z.string().min(1).optional(),
})
export type ApprovalDecideInput = z.infer<typeof ApprovalDecideInput>

export const ReviewDecideInput = z.discriminatedUnion('decision', [
  z.object({ reviewId: Id, decision: z.literal('approve') }).strict(),
  z.object({
    reviewId: Id,
    decision: z.literal('reject'),
    feedback: z.string().min(1),
  }),
])
export type ReviewDecideInput = z.infer<typeof ReviewDecideInput>

const CommandBase = z.object({
  v: z.literal(1),
  id: Id,
  ts: Timestamp,
})

export const ClientMessage = z.discriminatedUnion('type', [
  CommandBase.extend({ type: z.literal('resume'), payload: ResumeInput }),
  CommandBase.extend({ type: z.literal('task.create'), payload: TaskCreateInput }),
  CommandBase.extend({ type: z.literal('task.enqueue'), payload: TaskEnqueueInput }),
  CommandBase.extend({ type: z.literal('task.cancel'), payload: TaskCancelInput }),
  CommandBase.extend({ type: z.literal('session.reply'), payload: SessionReplyInput }),
  CommandBase.extend({ type: z.literal('approval.decide'), payload: ApprovalDecideInput }),
  CommandBase.extend({ type: z.literal('review.decide'), payload: ReviewDecideInput }),
])
export type ClientMessage = z.infer<typeof ClientMessage>
