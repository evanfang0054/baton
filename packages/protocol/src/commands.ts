import { z } from 'zod'
import { Id, Timestamp } from './common.js'
import {
  AgentNode,
  FileNode,
  GroupNode,
  ImageNode,
  ReviewNode,
  TextNode,
} from './entities/index.js'
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

const NodeCreateBase = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive().default(320),
  h: z.number().positive().default(200),
  groupId: Id.nullable().default(null),
})

export const NodeCreateValue = z.discriminatedUnion('type', [
  NodeCreateBase.extend({
    type: z.literal('text'),
    data: TextNode.shape.data,
  }),
  NodeCreateBase.extend({
    type: z.literal('image'),
    data: ImageNode.shape.data,
  }),
  NodeCreateBase.extend({
    type: z.literal('file'),
    data: FileNode.shape.data,
  }),
  NodeCreateBase.extend({
    type: z.literal('agent'),
    data: AgentNode.shape.data.extend({ taskId: Id.nullable().default(null) }),
  }),
  NodeCreateBase.extend({
    type: z.literal('review'),
    data: ReviewNode.shape.data,
  }),
  NodeCreateBase.extend({
    type: z.literal('group'),
    data: GroupNode.shape.data,
  }),
])
export type NodeCreateValue = z.infer<typeof NodeCreateValue>

export const NodeCreateInput = z.object({
  canvasId: Id,
  node: NodeCreateValue,
})
export type NodeCreateInput = z.infer<typeof NodeCreateInput>

export const NodeUpdateInput = z.object({
  nodeId: Id,
  patch: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().positive().optional(),
      h: z.number().positive().optional(),
      data: z.unknown().optional(),
    })
    .strict(),
})
export type NodeUpdateInput = z.infer<typeof NodeUpdateInput>

export const NodeDeleteInput = z.object({ nodeId: Id })
export type NodeDeleteInput = z.infer<typeof NodeDeleteInput>

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
  CommandBase.extend({ type: z.literal('node.create'), payload: NodeCreateInput }),
  CommandBase.extend({ type: z.literal('node.update'), payload: NodeUpdateInput }),
  CommandBase.extend({ type: z.literal('node.delete'), payload: NodeDeleteInput }),
])
export type ClientMessage = z.infer<typeof ClientMessage>
